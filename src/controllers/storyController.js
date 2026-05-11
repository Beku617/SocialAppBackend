const Story = require("../models/Story");
const { createHttpError } = require("../utils/httpError");
const {
  canViewerSeeContent,
  normalizeVisibilityForRead,
  normalizeVisibilityInput,
} = require("../utils/visibility");

const STORY_TTL_HOURS = 24;

const purgeExpiredStories = async () => {
  await Story.deleteMany({ expiresAt: { $lte: new Date() } });
};

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const buildFriendIdSet = (user) =>
  new Set(Array.isArray(user?.friends) ? user.friends.map(toIdString) : []);

const canViewerSeeStory = (story, viewerId, friendIdSet) =>
  canViewerSeeContent({
    visibility: story?.visibility,
    authorId: toIdString(story?.author),
    viewerId,
    friendIdSet,
  });

// GET /api/stories — fetch all non-expired stories, grouped by author
exports.listStories = async (req, res, next) => {
  try {
    await purgeExpiredStories();
    const viewerId = req.user?._id?.toString() || "";
    const friendIdSet = buildFriendIdSet(req.user);
    const stories = await Story.find({ expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .populate("author", "name avatarUrl")
      .lean();

    // Group by author
    const grouped = {};
    for (const s of stories) {
      if (!s?.author?._id) continue;
      if (!canViewerSeeStory(s, viewerId, friendIdSet)) continue;

      const authorId = s.author._id.toString();
      if (!grouped[authorId]) {
        grouped[authorId] = {
          user: {
            id: authorId,
            name: s.author.name,
            avatarUrl: s.author.avatarUrl,
          },
          stories: [],
        };
      }
      grouped[authorId].stories.push({
        id: s._id.toString(),
        imageUrl: s.imageUrl,
        caption: s.caption,
        visibility: normalizeVisibilityForRead(s.visibility),
        viewers: s.viewers.map((v) => v.toString()),
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      });
    }

    // Put current user's stories first if they exist
    const result = Object.values(grouped);
    if (viewerId) {
      result.sort((a, b) => {
        if (a.user.id === viewerId) return -1;
        if (b.user.id === viewerId) return 1;
        return 0;
      });
    }

    res.json({ storyGroups: result });
  } catch (err) {
    next(err);
  }
};

// POST /api/stories — create a story (image required)
exports.createStory = async (req, res, next) => {
  try {
    const { imageUrl, caption } = req.body;
    const visibility = normalizeVisibilityInput(req.body.visibility, {
      errorMessage: "Invalid story visibility",
    });

    const story = await Story.create({
      author: req.user._id,
      imageUrl,
      caption: caption || "",
      visibility,
      expiresAt: new Date(Date.now() + STORY_TTL_HOURS * 60 * 60 * 1000),
    });

    await story.populate("author", "name avatarUrl");

    res.status(201).json({
      story: {
        id: story._id.toString(),
        author: {
          id: story.author._id.toString(),
          name: story.author.name,
          avatarUrl: story.author.avatarUrl,
        },
        imageUrl: story.imageUrl,
        caption: story.caption,
        visibility: normalizeVisibilityForRead(story.visibility),
        viewers: [],
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/stories/:storyId/view — mark story as viewed
exports.viewStory = async (req, res, next) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });

    const viewerId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    if (!canViewerSeeStory(story, viewerId, friendIdSet)) {
      throw createHttpError(403, "You cannot view this story");
    }

    const userId = req.user._id;
    if (!story.viewers.some((v) => v.toString() === userId.toString())) {
      story.viewers.push(userId);
      await story.save();
    }

    res.json({ message: "Story viewed" });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/stories/:storyId — delete own story
exports.deleteStory = async (req, res, next) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });

    if (story.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not your story" });
    }

    await story.deleteOne();
    res.json({ message: "Story deleted" });
  } catch (err) {
    next(err);
  }
};

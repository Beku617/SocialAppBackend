const Story = require("../models/Story");

const STORY_TTL_HOURS = 24;

// GET /api/stories — fetch all non-expired stories, grouped by author
exports.listStories = async (req, res, next) => {
  try {
    const stories = await Story.find({ expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .populate("author", "name avatarUrl")
      .lean();

    // Group by author
    const grouped = {};
    for (const s of stories) {
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
        viewers: s.viewers.map((v) => v.toString()),
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      });
    }

    // Put current user's stories first if they exist
    const userId = req.user?._id?.toString();
    const result = Object.values(grouped);
    if (userId) {
      result.sort((a, b) => {
        if (a.user.id === userId) return -1;
        if (b.user.id === userId) return 1;
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

    const story = await Story.create({
      author: req.user._id,
      imageUrl,
      caption: caption || "",
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

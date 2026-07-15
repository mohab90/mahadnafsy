const lmsService = require('./lms.service');

class LmsController {
  async getCourses(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 500;
      const offset = parseInt(req.query.offset) || 0;
      const courses = await lmsService.getAllCourses(limit, offset);
      res.json(courses);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getCourse(req, res) {
    try {
      const course = await lmsService.getCourse(req.params.id);
      res.json(course);
    } catch (error) {
      if (error.message === 'Course not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  async createCourse(req, res) {
    try {
      const course = await lmsService.createCourse(req.body);
      res.status(201).json(course);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateCourse(req, res) {
    try {
      const course = await lmsService.updateCourse(req.params.id, req.body);
      res.json(course);
    } catch (error) {
      if (error.message === 'Course not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(400).json({ error: error.message });
      }
    }
  }

  async deleteCourse(req, res) {
    try {
      await lmsService.deleteCourse(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      if (error.message === 'Course not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  async getCourseChapters(req, res) {
    try {
      const chapters = await lmsService.getCourseChapters(req.params.courseId);
      res.json(chapters);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createChapter(req, res) {
    try {
      const chapter = await lmsService.createChapter(req.params.courseId, req.body);
      res.status(201).json(chapter);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getChapterLectures(req, res) {
    try {
      const lectures = await lmsService.getChapterLectures(req.params.chapterId);
      res.json(lectures);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createLecture(req, res) {
    try {
      const lecture = await lmsService.createLecture(req.params.chapterId, req.params.courseId, req.body);
      res.status(201).json(lecture);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new LmsController();

const express = require('express');
const router = express.Router();
const lmsController = require('./lms.controller');
const { requireAuth, requireAdmin } = require('../../../middleware/auth');

// Course routes
router.get('/courses', requireAuth, requireAdmin, lmsController.getCourses.bind(lmsController));
router.get('/courses/:id', requireAuth, requireAdmin, lmsController.getCourse.bind(lmsController));
router.post('/courses', requireAuth, requireAdmin, lmsController.createCourse.bind(lmsController));
router.put('/courses/:id', requireAuth, requireAdmin, lmsController.updateCourse.bind(lmsController));
router.delete('/courses/:id', requireAuth, requireAdmin, lmsController.deleteCourse.bind(lmsController));

// Chapter routes
router.get('/courses/:courseId/chapters', requireAuth, requireAdmin, lmsController.getCourseChapters.bind(lmsController));
router.post('/courses/:courseId/chapters', requireAuth, requireAdmin, lmsController.createChapter.bind(lmsController));

// Lecture routes
router.get('/courses/:courseId/chapters/:chapterId/lectures', requireAuth, requireAdmin, lmsController.getChapterLectures.bind(lmsController));
router.post('/courses/:courseId/chapters/:chapterId/lectures', requireAuth, requireAdmin, lmsController.createLecture.bind(lmsController));

module.exports = router;

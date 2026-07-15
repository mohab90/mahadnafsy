const lmsRepository = require('./lms.repository');
const { uuidv4 } = require('../../../lib/id');

class LmsService {
  async getAllCourses(limit, offset) {
    const courses = await lmsRepository.getCourses(limit, offset);
    return courses.map(this._mapCourse);
  }

  async getCourse(id) {
    const course = await lmsRepository.getCourseById(id);
    if (!course) throw new Error('Course not found');
    return this._mapCourse(course);
  }

  async createCourse(data) {
    this._validateCourseData(data);
    const courseId = data.id || uuidv4();
    const courseData = {
      id: courseId,
      title: data.title,
      description: data.description || '',
      category: data.category || 'GENERAL',
      is_published: data.is_published ? 1 : 0
      // Map other fields as needed
    };
    await lmsRepository.createCourse(courseData);
    return courseData;
  }

  async updateCourse(id, data) {
    const course = await lmsRepository.getCourseById(id);
    if (!course) throw new Error('Course not found');
    
    const updateData = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.is_published !== undefined) updateData.is_published = data.is_published ? 1 : 0;

    await lmsRepository.updateCourse(id, updateData);
    return { ...course, ...updateData };
  }

  async deleteCourse(id) {
    const course = await lmsRepository.getCourseById(id);
    if (!course) throw new Error('Course not found');
    await lmsRepository.deleteCourse(id);
    return { success: true };
  }

  // Chapters
  async getCourseChapters(courseId) {
    return await lmsRepository.getCourseChapters(courseId);
  }

  async createChapter(courseId, data) {
    if (!data.title) throw new Error('Chapter title is required');
    const chapterId = data.id || uuidv4();
    const chapterData = {
      id: chapterId,
      course_id: courseId,
      title: data.title,
      sort_order: data.sort_order || 0
    };
    await lmsRepository.createCourseChapter(chapterData);
    return chapterData;
  }

  // Lectures
  async getChapterLectures(chapterId) {
    return await lmsRepository.getCourseLectures(chapterId);
  }

  async createLecture(chapterId, courseId, data) {
    if (!data.title) throw new Error('Lecture title is required');
    const lectureId = data.id || uuidv4();
    const lectureData = {
      id: lectureId,
      course_id: courseId,
      chapter_id: chapterId,
      title: data.title,
      video_url: data.video_url || '',
      sort_order: data.sort_order || 0,
      is_preview: data.is_preview ? 1 : 0
    };
    await lmsRepository.createCourseLecture(lectureData);
    return lectureData;
  }

  _validateCourseData(data) {
    if (!data.title) {
      throw new Error('Course title is required');
    }
  }

  _mapCourse(course) {
    // Basic mapping logic
    return {
      ...course,
      is_published: !!course.is_published,
    };
  }
}

module.exports = new LmsService();

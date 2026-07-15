const { pool } = require('../../../lib/db');

class LmsRepository {
  async getCourses(limit = 500, offset = 0) {
    const [rows] = await pool.query(
      `SELECT * FROM courses ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows;
  }

  async getCourseById(id) {
    const [[course]] = await pool.query(`SELECT * FROM courses WHERE id = ? LIMIT 1`, [id]);
    return course;
  }

  async createCourse(courseData) {
    const fields = Object.keys(courseData).join(', ');
    const placeholders = Object.keys(courseData).map(() => '?').join(', ');
    const values = Object.values(courseData);
    
    await pool.query(`INSERT INTO courses (${fields}) VALUES (${placeholders})`, values);
    return courseData.id;
  }

  async updateCourse(id, courseData) {
    const sets = Object.keys(courseData).map(k => `${k}=?`).join(', ');
    const values = [...Object.values(courseData), id];
    await pool.query(`UPDATE courses SET ${sets} WHERE id=?`, values);
    return id;
  }

  async deleteCourse(id) {
    await pool.query('DELETE FROM courses WHERE id = ?', [id]);
  }

  async getCourseChapters(courseId) {
    const [rows] = await pool.query(
      'SELECT id, course_id, title, sort_order FROM course_chapters WHERE course_id = ? ORDER BY sort_order ASC', 
      [courseId]
    );
    return rows;
  }

  async createCourseChapter(chapterData) {
    const fields = Object.keys(chapterData).join(', ');
    const placeholders = Object.keys(chapterData).map(() => '?').join(', ');
    const values = Object.values(chapterData);
    await pool.query(`INSERT INTO course_chapters (${fields}) VALUES (${placeholders})`, values);
    return chapterData.id;
  }

  async updateCourseChapter(id, chapterData) {
    const sets = Object.keys(chapterData).map(k => `${k}=?`).join(', ');
    const values = [...Object.values(chapterData), id];
    await pool.query(`UPDATE course_chapters SET ${sets} WHERE id=?`, values);
    return id;
  }

  async deleteCourseChapter(id) {
    await pool.query('DELETE FROM course_chapters WHERE id = ?', [id]);
  }

  async getCourseLectures(chapterId) {
    const [rows] = await pool.query(
      'SELECT id, course_id, chapter_id, title, video_url, sort_order, is_preview FROM course_lectures WHERE chapter_id = ? ORDER BY sort_order ASC',
      [chapterId]
    );
    return rows;
  }

  async createCourseLecture(lectureData) {
    const fields = Object.keys(lectureData).join(', ');
    const placeholders = Object.keys(lectureData).map(() => '?').join(', ');
    const values = Object.values(lectureData);
    await pool.query(`INSERT INTO course_lectures (${fields}) VALUES (${placeholders})`, values);
    return lectureData.id;
  }

  async updateCourseLecture(id, lectureData) {
    const sets = Object.keys(lectureData).map(k => `${k}=?`).join(', ');
    const values = [...Object.values(lectureData), id];
    await pool.query(`UPDATE course_lectures SET ${sets} WHERE id=?`, values);
    return id;
  }

  async deleteCourseLecture(id) {
    await pool.query('DELETE FROM course_lectures WHERE id = ?', [id]);
  }
}

module.exports = new LmsRepository();

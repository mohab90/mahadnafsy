// @ts-nocheck
import { create } from 'zustand';
import { Course, Bundle, CourseLectureItem, CourseChapterItem, CourseQuiz, QuizAttempt, LiveStream, Therapist, TestimonialItem } from '../types';
import { mysqlAdmin } from '../lib/mysqlapi';

const logPersistError = (what: string) => (err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[useLmsStore] failed to persist ${what}:`, err);
};

interface LmsState {
  courses: Course[];
  bundles: Bundle[];
  lectures: CourseLectureItem[];
  chapters: CourseChapterItem[];
  courseQuizzes: CourseQuiz[];
  quizAttempts: QuizAttempt[];
  liveStreams: LiveStream[];
  therapists: Therapist[];
  testimonials: TestimonialItem[];
  
  setCourses: (courses: Course[]) => void;
  setBundles: (bundles: Bundle[]) => void;
  setLectures: (lectures: CourseLectureItem[]) => void;
  setChapters: (chapters: CourseChapterItem[]) => void;
  setCourseQuizzes: (courseQuizzes: CourseQuiz[]) => void;
  setQuizAttempts: (quizAttempts: QuizAttempt[]) => void;
  setLiveStreams: (liveStreams: LiveStream[]) => void;
  setTherapists: (therapists: Therapist[]) => void;
  setTestimonials: (testimonials: TestimonialItem[]) => void;

  addCourse: (course: Course) => void;
  updateCourse: (course: Course) => void;
  deleteCourse: (id: string) => void;

  addBundle: (bundle: Bundle) => void;
  updateBundle: (bundle: Bundle) => void;
  deleteBundle: (id: string) => void;

  addLecture: (item: CourseLectureItem) => void;
  updateLecture: (item: CourseLectureItem) => void;
  deleteLecture: (id: string) => void;

  addChapter: (item: CourseChapterItem) => void;
  updateChapter: (item: CourseChapterItem) => void;
  deleteChapter: (id: string) => void;

  addCourseQuiz: (item: CourseQuiz) => void;
  updateCourseQuiz: (item: CourseQuiz) => void;
  deleteCourseQuiz: (id: string) => void;

  addQuizAttempt: (item: QuizAttempt) => void;
  deleteQuizAttempt: (id: string) => void;

  addLiveStream: (item: LiveStream) => void;
  updateLiveStream: (item: LiveStream) => void;
  deleteLiveStream: (id: string) => void;

  addTherapist: (item: Therapist) => void;
  updateTherapist: (item: Therapist) => void;
  deleteTherapist: (id: string) => void;

  addTestimonial: (item: TestimonialItem) => void;
  updateTestimonial: (item: TestimonialItem) => void;
  deleteTestimonial: (id: number) => void;
}

export const useLmsStore = create<LmsState>((set) => ({
  courses: [],
  bundles: [],
  lectures: [],
  chapters: [],
  courseQuizzes: [],
  quizAttempts: [],
  liveStreams: [],
  therapists: [],
  testimonials: [],

  setCourses: (courses) => set({ courses }),
  setBundles: (bundles) => set({ bundles }),
  setLectures: (lectures) => set({ lectures }),
  setChapters: (chapters) => set({ chapters }),
  setCourseQuizzes: (courseQuizzes) => set({ courseQuizzes }),
  setQuizAttempts: (quizAttempts) => set({ quizAttempts }),
  setLiveStreams: (liveStreams) => set({ liveStreams }),
  setTherapists: (therapists) => set({ therapists }),
  setTestimonials: (testimonials) => set({ testimonials }),

  addCourse: (course) => {
    set((state) => ({ courses: [...state.courses, course] }));
    void mysqlAdmin.saveCourse(course).catch(logPersistError('course'));
  },
  updateCourse: (course) => {
    set((state) => ({ courses: state.courses.map((c) => (c.id === course.id ? course : c)) }));
    void mysqlAdmin.saveCourse(course).catch(logPersistError('course'));
  },
  deleteCourse: (id) => set((state) => ({ courses: state.courses.filter((c) => c.id !== id) })),

  addBundle: (bundle) => {
    set((state) => ({ bundles: [...state.bundles, bundle] }));
    void mysqlAdmin.saveBundle(bundle).catch(logPersistError('bundle'));
  },
  updateBundle: (bundle) => {
    set((state) => ({ bundles: state.bundles.map((b) => (b.id === bundle.id ? bundle : b)) }));
    void mysqlAdmin.saveBundle(bundle).catch(logPersistError('bundle'));
  },
  deleteBundle: (id) => set((state) => ({ bundles: state.bundles.filter((b) => b.id !== id) })),

  addLecture: (item) => {
    set((state) => ({ lectures: [...state.lectures, item] }));
    void mysqlAdmin.saveLecture(item).catch(logPersistError('lecture'));
  },
  updateLecture: (item) => {
    set((state) => ({ lectures: state.lectures.map((l) => (l.id === item.id ? item : l)) }));
    void mysqlAdmin.saveLecture(item).catch(logPersistError('lecture'));
  },
  deleteLecture: (id) => set((state) => ({ lectures: state.lectures.filter((l) => l.id !== id) })),

  addChapter: (item) => {
    set((state) => ({ chapters: [...state.chapters, item] }));
    void mysqlAdmin.saveChapter(item).catch(logPersistError('chapter'));
  },
  updateChapter: (item) => {
    set((state) => ({ chapters: state.chapters.map((c) => (c.id === item.id ? item : c)) }));
    void mysqlAdmin.saveChapter(item).catch(logPersistError('chapter'));
  },
  deleteChapter: (id) => set((state) => ({ chapters: state.chapters.filter((c) => c.id !== id) })),

  addCourseQuiz: (item) => {
    set((state) => ({ courseQuizzes: [...state.courseQuizzes, item] }));
    void mysqlAdmin.saveQuiz(item).catch(logPersistError('quiz'));
  },
  updateCourseQuiz: (item) => {
    set((state) => ({ courseQuizzes: state.courseQuizzes.map((q) => (q.id === item.id ? item : q)) }));
    void mysqlAdmin.saveQuiz(item).catch(logPersistError('quiz'));
  },
  deleteCourseQuiz: (id) => set((state) => ({ courseQuizzes: state.courseQuizzes.filter((q) => q.id !== id) })),

  addQuizAttempt: (item) => set((state) => ({ quizAttempts: [item, ...state.quizAttempts] })),
  deleteQuizAttempt: (id) => set((state) => ({ quizAttempts: state.quizAttempts.filter((q) => q.id !== id) })),

  addLiveStream: (item) => {
    set((state) => ({ liveStreams: [item, ...state.liveStreams] }));
    void mysqlAdmin.saveLiveStream(item).catch(logPersistError('live stream'));
  },
  updateLiveStream: (item) => {
    set((state) => ({ liveStreams: state.liveStreams.map((l) => (l.id === item.id ? item : l)) }));
    void mysqlAdmin.saveLiveStream(item).catch(logPersistError('live stream'));
  },
  deleteLiveStream: (id) => set((state) => ({ liveStreams: state.liveStreams.filter((l) => l.id !== id) })),

  addTherapist: (item) => {
    set((state) => ({ therapists: [...state.therapists, item] }));
    void mysqlAdmin.saveTherapist(item).catch(logPersistError('therapist'));
  },
  updateTherapist: (item) => {
    set((state) => ({ therapists: state.therapists.map((t) => (t.id === item.id ? item : t)) }));
    void mysqlAdmin.saveTherapist(item).catch(logPersistError('therapist'));
  },
  deleteTherapist: (id) => set((state) => ({ therapists: state.therapists.filter((t) => t.id !== id) })),

  addTestimonial: (item) => {
    set((state) => ({ testimonials: [...state.testimonials, item] }));
    void mysqlAdmin.saveTestimonial(item).catch(logPersistError('testimonial'));
  },
  updateTestimonial: (item) => {
    set((state) => ({ testimonials: state.testimonials.map((t) => (t.id === item.id ? item : t)) }));
    void mysqlAdmin.saveTestimonial(item).catch(logPersistError('testimonial'));
  },
  deleteTestimonial: (id) => set((state) => ({ testimonials: state.testimonials.filter((t) => t.id !== id) })),
}));


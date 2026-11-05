/**
 * What the student dashboard shows besides the courses — the broadcasts (and which the student has read), the live streams, the quizzes, the student's own quiz attempts
 * and their consultations — in ONE request (GET /api/me/student-extras) instead of five. Each piece is null when the server could not answer it, and so is the whole when
 * the request fails: whoever reads a piece asks that piece's own route then, so a failure costs what it always did and nothing more.
 * One answer per signed-in student for the life of the page; a different student (sign-out, sign-in) asks again, and a failed answer is not kept.
 * The fetcher is handed in, so this file holds no import and the hooks that use it stay as easy to run in a test as they were.
 */

export type StudentExtras = {
  notifications: { notifications: unknown[]; readIds: string[] } | null;
  liveStreams: unknown[] | null;
  quizzes: unknown[] | null;
  quizAttempts: unknown[] | null;
  consultations: unknown[] | null;
};

let current: { uid: string; answer: Promise<StudentExtras | null> } | null = null;

export function loadStudentExtras(uid: string, fetchExtras: () => Promise<StudentExtras>): Promise<StudentExtras | null> {
  if (!current || current.uid !== uid) {
    const answer = fetchExtras().then(value => (value && typeof value === 'object' ? value : null)).catch(() => null);
    const entry = { uid, answer };
    current = entry;
    void answer.then(value => { if (!value && current === entry) current = null; });
  }
  return current.answer;
}

/** One piece of it, or — when the bundle did not carry it — what that piece's own route answers. */
export function studentPiece<K extends keyof StudentExtras>(
  uid: string,
  fetchExtras: () => Promise<StudentExtras>,
  key: K,
  own: () => Promise<NonNullable<StudentExtras[K]>>,
): Promise<NonNullable<StudentExtras[K]>> {
  return loadStudentExtras(uid, fetchExtras).then(extras => (extras?.[key] ?? own()) as NonNullable<StudentExtras[K]>);
}

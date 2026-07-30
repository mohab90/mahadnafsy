import React, { useState, useMemo } from 'react';
import { BookOpen, Download, FileText, Save, Sparkles } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { SafeHtml } from '../../../../shared/ui/SafeHtml';
import type { Course, CourseLectureItem, CourseQuiz, QuizAttempt, QuizQuestion } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
}

const safeStoredImageSrc = (image: string | undefined) => {
  const value = String(image || '').trim();
  if (!value || /top4top\.io/i.test(value)) return '';
  return value;
};

// ─── AI helper ───────────────────────────────────────────────────────────────
async function callAI(prompt: string, maxTokens = 6000): Promise<string> {
  const { text } = await mysqlAdmin.generateAdminAi({
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
  });
  return text;
}

// ─── PDF download helper ──────────────────────────────────────────────────────
function downloadLectureNotesAsPdf(lectureTitle: string, courseTitle: string, htmlContent: string) {
  const doc = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>${lectureTitle}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cairo', 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #1a1a2e; background: #fff; padding: 40px 50px; line-height: 1.8; }
  .header { border-bottom: 3px solid #4f46e5; padding-bottom: 16px; margin-bottom: 28px; }
  .course-label { font-size: 11px; color: #6366f1; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
  h1 { font-size: 22px; font-weight: 900; color: #1e1b4b; margin-top: 6px; }
  h2 { font-size: 16px; font-weight: 700; color: #4f46e5; margin: 22px 0 10px; padding-right: 10px; border-right: 3px solid #4f46e5; }
  h3 { font-size: 14px; font-weight: 700; color: #374151; margin: 14px 0 6px; }
  p { margin: 6px 0 10px; color: #374151; }
  ul, ol { padding-right: 20px; margin: 8px 0; }
  li { margin: 4px 0; color: #374151; }
  .box { background: #f0f4ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 14px 18px; margin: 14px 0; }
  .box.tip { background: #ecfdf5; border-color: #6ee7b7; }
  .box.warn { background: #fffbeb; border-color: #fcd34d; }
  .footer { margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 12px; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 20px 30px; } }
</style>
</head>
<body>
<div class="header">
  <div class="course-label">${courseTitle}</div>
  <h1>${lectureTitle}</h1>
  <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
</div>
${htmlContent}
<div class="footer">تم إنشاء هذا المحتوى بالذكاء الاصطناعي — ${courseTitle}</div>
</body>
</html>`;

  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.onload = () => { win.print(); URL.revokeObjectURL(url); };
  } else {
    // Fallback: direct download
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lectureTitle.replace(/[/\\?%*:|"<>]/g, '-')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ─── Main component ───────────────────────────────────────────────────────────
const QuizzesTab: React.FC<Props> = ({ notify }) => {
  const { courses, lectures: allLectures, courseQuizzes, quizAttempts,
    addCourseQuiz, updateCourseQuiz, deleteCourseQuiz, updateLecture } = useSiteData();

  const [mainTab, setMainTab] = useState<'quiz' | 'content'>('quiz');
  const [selectedCourseId, setSelectedCourseId] = useState('');

  // ── Quiz state ──
  const [quizMaterial, setQuizMaterial] = useState('');
  const [quizGenerating, setQuizGenerating] = useState(false);
  const [quizDraft, setQuizDraft] = useState<CourseQuiz | null>(null);
  const [quizPassingScore, setQuizPassingScore] = useState(70);
  const [quizEditIdx, setQuizEditIdx] = useState<number | null>(null);

  // ── Content/PDF state ──
  const [selectedLectureId, setSelectedLectureId] = useState('');
  const [generatingLectureId, setGeneratingLectureId] = useState('');
  const [notesCache, setNotesCache] = useState<Record<string, string>>({});
  const [savingLectureId, setSavingLectureId] = useState('');

  const selectedCourse = courses.find((c: Course) => String(c.id) === selectedCourseId);
  const existingQuiz = courseQuizzes.find((q: CourseQuiz) => q.courseId === selectedCourseId);
  const activeQuiz = quizDraft || existingQuiz || null;
  const courseAttempts = quizAttempts.filter((a: QuizAttempt) => a.courseId === selectedCourseId);
  const avgScore = courseAttempts.length > 0 ? Math.round(courseAttempts.reduce((s: number, a: QuizAttempt) => s + a.score, 0) / courseAttempts.length) : null;

  // Lectures for selected course
  const courseLectures = useMemo(() =>
    allLectures.filter((l: CourseLectureItem) => String(l.courseId) === selectedCourseId)
      .sort((a: CourseLectureItem, b: CourseLectureItem) => (a.order ?? 0) - (b.order ?? 0)),
    [allLectures, selectedCourseId]
  );

  // Build material from lectures list
  const buildMaterial = () => {
    if (!selectedCourse) return '';
    let mat = `الكورس: ${selectedCourse.title}\n`;
    if (selectedCourse.description) mat += `الوصف: ${selectedCourse.description}\n\n`;
    if (courseLectures.length > 0) {
      mat += `محاضرات الكورس (${courseLectures.length} محاضرة):\n`;
      courseLectures.forEach((l: CourseLectureItem, i: number) => { mat += `${i + 1}. ${l.title}\n`; });
    }
    return mat;
  };

  // ── Generate quiz ──
  const handleGenerateQuiz = async () => {
    if (!selectedCourse) return;
    setQuizGenerating(true);
    try {
      const material = quizMaterial || buildMaterial();
      const prompt = `أنت خبير في تصميم الاختبارات التعليمية. بناءً على المادة العلمية التالية، أنشئ 20 سؤال اختيار من متعدد باللغة العربية.\n\nالمادة:\n${material}\n\nأعطني فقط JSON array بالتنسيق التالي بدون أي نص إضافي:\n[{"question":"...","options":["أ: ...","ب: ...","ج: ...","د: ..."],"correctIndex":0,"explanation":"..."}]`;
      const text = await callAI(prompt, 5000);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('لم يتم إرجاع JSON صحيح من الذكاء الاصطناعي');
      const raw = JSON.parse(jsonMatch[0]) as { question: string; options: string[]; correctIndex: number; explanation?: string }[];
      const questions: QuizQuestion[] = raw.slice(0, 20).map((q, idx) => ({
        id: `q-${idx}`,
        question: q.question,
        options: (q.options.length >= 4 ? q.options.slice(0, 4) : [...q.options, '', '', '', ''].slice(0, 4)) as [string, string, string, string],
        correctIndex: (q.correctIndex >= 0 && q.correctIndex <= 3 ? q.correctIndex : 0) as 0|1|2|3,
        explanation: q.explanation,
      }));
      const now = new Date().toISOString();
      setQuizDraft({ id: existingQuiz?.id || `quiz-${Date.now()}`, courseId: selectedCourseId, title: `اختبار ${selectedCourse.title}`, questions, passingScore: quizPassingScore, createdAt: existingQuiz?.createdAt || now, updatedAt: now, generatedByAI: true, sourceMaterial: material });
    } catch (err) { alert(err instanceof Error ? err.message : 'حدث خطأ أثناء التوليد'); }
    setQuizGenerating(false);
  };

  const handleSaveQuiz = async () => {
    if (!quizDraft) return;
    const updated = { ...quizDraft, passingScore: quizPassingScore, updatedAt: new Date().toISOString() };
    const saved = existingQuiz ? await updateCourseQuiz(updated) : await addCourseQuiz(updated);
    if (!saved) {
      notify('error', 'تعذر حفظ الاختبار في قاعدة البيانات');
      return;
    }
    setQuizDraft(null);
    notify('success', 'تم حفظ الاختبار');
  };

  // ── Generate lecture notes ──
  const handleGenerateNotes = async (lectureId: string) => {
    const lecture = courseLectures.find((l: CourseLectureItem) => l.id === lectureId);
    if (!lecture || !selectedCourse) return;
    setGeneratingLectureId(lectureId);
    try {
      const lectureList = courseLectures.map((l: CourseLectureItem, i: number) => `${i + 1}. ${l.title}`).join('\n');
      const prompt = `أنت خبير تعليمي. اكتب محتوى تعليمياً شاملاً ومنظماً للمحاضرة التالية.

الكورس: ${selectedCourse.title}
المحاضرة: ${lecture.title}
قائمة محاضرات الكورس للسياق:
${lectureList}

اكتب المحتوى باللغة العربية بصيغة HTML باستخدام العناصر التالية فقط: <h2> للعناوين الرئيسية، <h3> للعناوين الفرعية، <p> للفقرات، <ul>/<li> للنقاط، <ol>/<li> للخطوات، <div class="box"> للمعلومات المهمة، <div class="box tip"> للنصائح، <div class="box warn"> للتحذيرات.

يجب أن يحتوي المحتوى على:
1. مقدمة المحاضرة وأهدافها
2. المحاور الرئيسية مع شرح تفصيلي
3. أمثلة تطبيقية
4. نقاط مراجعة سريعة
5. خلاصة المحاضرة

أعطني HTML مباشرة بدون أي نص إضافي خارج الـ HTML.`;
      const html = await callAI(prompt, 8000);
      // Strip possible code fences
      const clean = html.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
      setNotesCache(prev => ({ ...prev, [lectureId]: clean }));
      setSelectedLectureId(lectureId);
      notify('success', `تم توليد محتوى محاضرة "${lecture.title}"`);
    } catch (err) { alert(err instanceof Error ? err.message : 'حدث خطأ'); }
    setGeneratingLectureId('');
  };

  const getLectureNotes = (lectureId: string): string => {
    if (notesCache[lectureId]) return notesCache[lectureId];
    return courseLectures.find(lecture => lecture.id === lectureId)?.aiNotes || '';
  };

  const handleSaveLectureNotes = async (lectureId: string) => {
    const lecture = courseLectures.find((l: CourseLectureItem) => l.id === lectureId);
    if (!lecture) return;
    const notes = getLectureNotes(lectureId);
    if (!notes) return;
    setSavingLectureId(lectureId);
    try {
      if (!await updateLecture({ ...lecture, aiNotes: notes })) throw new Error('Lecture save failed');
      notify('success', 'تم حفظ المحتوى في قاعدة البيانات');
    } catch {
      notify('error', 'تعذر حفظ المحتوى في قاعدة البيانات');
    }
    setSavingLectureId('');
  };

  // ── Course sidebar ──
  const CourseSidebar = () => (
    <div className="w-64 flex-shrink-0 space-y-1 max-h-[640px] overflow-y-auto pr-1">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider pb-1.5">الكورسات ({courses.length})</p>
      {courses.map((course: Course) => {
        const hasQuiz = courseQuizzes.some((q: CourseQuiz) => q.courseId === String(course.id));
        const notesCount = allLectures.filter((l: CourseLectureItem) => String(l.courseId) === String(course.id) && l.aiNotes).length;
        const isSel = selectedCourseId === String(course.id);
        const thumbnailSrc = safeStoredImageSrc(course.thumbnail);
        return (
          <button key={course.id}
            onClick={() => { setSelectedCourseId(String(course.id)); setQuizDraft(null); setQuizEditIdx(null); setQuizMaterial(''); setSelectedLectureId(''); }}
            className={['w-full text-right p-2.5 rounded-xl border transition', isSel ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-gray-100 hover:border-gray-200'].join(' ')}>
            <div className="flex items-center gap-2">
              {thumbnailSrc ? <img src={thumbnailSrc} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" /> : <BookOpen size={18} className="text-gray-300 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 text-xs leading-snug line-clamp-1">{course.title}</p>
                <div className="flex gap-1 mt-0.5">
                  {hasQuiz && <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1 rounded">اختبار</span>}
                  {notesCount > 0 && <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1 rounded">{notesCount} محتوى</span>}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex gap-4 min-h-96" dir="rtl">
      <CourseSidebar />

      <div className="flex-1 min-w-0">
        {!selectedCourseId ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
            <FileText size={40} className="text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500 font-bold">اختر كورساً من القائمة</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 shadow-sm">
              <h3 className="font-extrabold text-gray-900 text-base">{selectedCourse?.title}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{courseLectures.length} محاضرة</p>
            </div>

            {/* Main tabs */}
            <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
              <button onClick={() => setMainTab('quiz')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 ${mainTab === 'quiz' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                <FileText size={14} /> اختبارات الكورس
              </button>
              <button onClick={() => setMainTab('content')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 ${mainTab === 'content' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                <BookOpen size={14} /> محتوى المحاضرات (PDF)
              </button>
            </div>

            {/* ── QUIZ TAB ── */}
            {mainTab === 'quiz' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <p className="text-xs text-gray-500">{existingQuiz ? `اختبار موجود — ${existingQuiz.questions.length} سؤال` : 'لا يوجد اختبار بعد'}</p>
                    <div className="flex gap-2">
                      {existingQuiz && <button onClick={() => { if (confirm('حذف هذا الاختبار؟')) { deleteCourseQuiz(existingQuiz.id); setQuizDraft(null); } }} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-lg border border-red-200 transition">حذف</button>}
                      {activeQuiz && <button onClick={handleSaveQuiz} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-lg transition flex items-center gap-1"><Save size={12}/>حفظ</button>}
                    </div>
                  </div>
                  {courseAttempts.length > 0 && (
                    <div className="mt-3 flex gap-3 text-xs flex-wrap">
                      <span className="bg-blue-50 text-blue-700 font-bold px-3 py-1 rounded-full">{courseAttempts.length} محاولة</span>
                      {avgScore !== null && <span className="bg-amber-50 text-amber-700 font-bold px-3 py-1 rounded-full">متوسط {avgScore}%</span>}
                      <span className="bg-green-50 text-green-700 font-bold px-3 py-1 rounded-full">{courseAttempts.filter((a: QuizAttempt) => a.passed).length} ناجح</span>
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
                  <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm"><Sparkles size={15} className="text-purple-500"/>توليد اختبار بالذكاء الاصطناعي (20 سؤال)</h4>
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-700">
                    <strong>المنهج المستخدم ({courseLectures.length} محاضرة):</strong>
                    <div className="mt-1 text-indigo-600 line-clamp-3">{courseLectures.map((l: CourseLectureItem) => l.title).join(' — ')}</div>
                  </div>
                  <textarea rows={3} value={quizMaterial} onChange={e => setQuizMaterial(e.target.value)}
                    placeholder="أضف محتوى إضافياً اختيارياً (أو اتركه فارغاً لاستخدام منهج الكورس تلقائياً)"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-purple-400 focus:outline-none resize-none" />
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold text-gray-600">نسبة النجاح %</label>
                      <input type="number" min={10} max={100} value={quizPassingScore} onChange={e => setQuizPassingScore(Number(e.target.value))}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:border-purple-400 focus:outline-none" />
                    </div>
                    <button onClick={handleGenerateQuiz} disabled={quizGenerating}
                      className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl transition text-sm">
                      {quizGenerating ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري التوليد...</> : <><Sparkles size={14}/>{existingQuiz ? 'إعادة التوليد' : 'توليد 20 سؤال'}</>}
                    </button>
                  </div>
                </div>
                {activeQuiz && activeQuiz.questions.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                      <h4 className="font-bold text-gray-800 text-sm">{activeQuiz.questions.length} سؤال</h4>
                      <span className="text-xs text-gray-500">النجاح: {activeQuiz.passingScore}%</span>
                    </div>
                    <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
                      {activeQuiz.questions.map((q: QuizQuestion, idx: number) => (
                        <div key={q.id} className="p-4">
                          {quizEditIdx === idx && quizDraft ? (
                            <div className="space-y-2">
                              <textarea value={q.question} rows={2} onChange={e => { const qs = [...quizDraft.questions]; qs[idx] = { ...qs[idx], question: e.target.value }; setQuizDraft({ ...quizDraft, questions: qs }); }}
                                className="w-full border border-indigo-300 rounded-lg px-2 py-1 text-sm focus:outline-none resize-none"/>
                              {q.options.map((opt, oi) => (
                                <div key={oi} className="flex items-center gap-2">
                                  <input type="radio" checked={q.correctIndex === oi} onChange={() => { const qs = [...quizDraft.questions]; qs[idx] = { ...qs[idx], correctIndex: oi as 0|1|2|3 }; setQuizDraft({ ...quizDraft, questions: qs }); }}/>
                                  <input value={opt} onChange={e => { const qs = [...quizDraft.questions]; const opts = [...qs[idx].options] as [string,string,string,string]; opts[oi] = e.target.value; qs[idx] = { ...qs[idx], options: opts }; setQuizDraft({ ...quizDraft, questions: qs }); }}
                                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none"/>
                                </div>
                              ))}
                              <button onClick={() => setQuizEditIdx(null)} className="text-xs text-indigo-600 font-bold">✔ تم</button>
                            </div>
                          ) : (
                            <div>
                              <p className="font-bold text-gray-800 text-sm mb-2">{idx + 1}. {q.question}</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                {q.options.map((opt, oi) => (
                                  <div key={oi} className={`text-xs px-2 py-1.5 rounded-lg border ${oi === q.correctIndex ? 'bg-green-50 border-green-400 text-green-700 font-bold' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>{opt}</div>
                                ))}
                              </div>
                              {q.explanation && <p className="text-[11px] text-gray-400 mt-1.5 italic">{q.explanation}</p>}
                              {quizDraft && <button onClick={() => setQuizEditIdx(idx)} className="mt-1 text-[11px] text-gray-400 hover:text-indigo-600">✏ تعديل</button>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="p-4 bg-gray-50 border-t border-gray-100">
                      <button onClick={handleSaveQuiz} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl transition text-sm flex items-center justify-center gap-2">
                        <Save size={15}/>حفظ الاختبار
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── CONTENT / PDF TAB ── */}
            {mainTab === 'content' && (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                  الذكاء الاصطناعي يولد محتوى تعليمي شامل لكل محاضرة — يمكن تنزيله كـ PDF أو حفظه مع المحاضرة.
                </div>
                {courseLectures.length === 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 text-sm">لا توجد محاضرات لهذا الكورس</div>
                )}
                {courseLectures.map((lecture: CourseLectureItem) => {
                  const notes = getLectureNotes(lecture.id);
                  const isGenSel = selectedLectureId === lecture.id;
                  const isGenerating = generatingLectureId === lecture.id;
                  const isSaving = savingLectureId === lecture.id;
                  const hasNotes = !!notes || !!lecture.aiNotes;
                  return (
                    <div key={lecture.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="px-5 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-black text-gray-300 w-6 text-center">{lecture.order ?? lecture.sortOrder ?? ''}</span>
                          <div>
                            <p className="font-bold text-gray-800 text-sm">{lecture.title}</p>
                            {lecture.duration && <p className="text-xs text-gray-400">{lecture.duration}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {hasNotes && (
                            <>
                              <button
                                onClick={() => downloadLectureNotesAsPdf(lecture.title, selectedCourse?.title || '', notes || lecture.aiNotes || '')}
                                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition">
                                <Download size={12}/> تنزيل PDF
                              </button>
                              <button
                                onClick={() => handleSaveLectureNotes(lecture.id)}
                                disabled={isSaving}
                                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition">
                                {isSaving ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/> : <Save size={12}/>}
                                {isSaving ? '...' : 'حفظ'}
                              </button>
                              <button onClick={() => setSelectedLectureId(isGenSel ? '' : lecture.id)} className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 border border-gray-200 rounded-lg">
                                {isGenSel ? 'إخفاء' : 'عرض'}
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleGenerateNotes(lecture.id)}
                            disabled={isGenerating}
                            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition disabled:opacity-50 ${hasNotes ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}>
                            {isGenerating ? <><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"/>توليد...</> : <><Sparkles size={11}/>{hasNotes ? 'إعادة توليد' : 'توليد محتوى'}</>}
                          </button>
                        </div>
                      </div>
                      {isGenSel && notes && (
                        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 prose prose-sm max-w-none"
                          style={{ direction: 'rtl', fontFamily: 'Cairo, Segoe UI, Arial, sans-serif' }}>
                          <SafeHtml html={notes || lecture.aiNotes || ''} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuizzesTab;

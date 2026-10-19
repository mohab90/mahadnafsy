import React, { useState } from 'react';
import { Search, BookOpen, Users, Play, Award } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import CourseCard from '../components/CourseCard';
import PageHeader from '../components/PageHeader';
import { useSeo } from '../lib/useSeo';

/** One filter choice, drawn as a pill: ink when chosen, paper when not. */
const Pill: React.FC<{ value: string; current: string; onPick: (value: string) => void; children: React.ReactNode }> = ({ value, current, onPick, children }) => {
  const on = value === current;
  return (
    <button
      type="button"
      value={value}
      aria-pressed={on}
      onClick={() => onPick(value)}
      className={`min-h-[44px] flex-none whitespace-nowrap rounded-full border px-4 text-[14px] font-extrabold transition ${on ? 'border-ink bg-ink text-white shadow-lg' : 'border-line bg-paper text-muted-strong hover:border-ink/30'}`}
    >
      {children}
    </button>
  );
};

// One line on a desktop; on a phone the pills slide sideways instead of wrapping into rows.
const pillRow = '-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] lg:mx-0 lg:flex-nowrap lg:justify-center lg:overflow-visible lg:px-0';

const Courses: React.FC = () => {
  const { courses, content, currency } = useSiteData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  useSeo({ title: 'الدبلومات والكورسات | معهد الدراسات النفسية', path: '/courses', description: 'دبلومات معتمدة في الصحة النفسية والعلاج النفسي — برامج تدريبية بشهادات موثقة من معهد الدراسات النفسية.' });

  const filteredCourses = courses.filter(course => {
    const matchesSearch = (course.title || '').includes(searchTerm) || (course.description || '').includes(searchTerm);
    const matchesCategory = selectedCategory === 'All' || course.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><BookOpen size={15} />{courses.length} برنامج تدريبي متاح</span>}
        title={content['courses.title'] || 'الدبلومات والبرامج التدريبية'}
        subtitle={content['courses.subtitle'] || 'استثمر في مستقبلك المهني مع أحدث البرامج التدريبية في علم النفس'}
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center">
          {[
            { icon: BookOpen, label: 'دبلومات معتمدة', sub: 'شهادات موثقة' },
            { icon: Users, label: '12,000+ طالب', sub: 'من الوطن العربي' },
            { icon: Play, label: 'محاضرات تفاعلية', sub: 'تسجيلات حصرية' },
            { icon: Award, label: 'تميز أكاديمي', sub: 'معايير دولية' },
          ].map(({ icon: Icon, label, sub }) => (
            <li key={label} className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-right ring-1 ring-line sm:px-4">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon size={18} /></span>
              <span className="min-w-0">
                <b className="block text-sm font-extrabold leading-tight text-ink">{label}</b>
                <span className="block text-xs text-muted">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </PageHeader>

      <section className="py-10 sm:py-14">
        <div className="container mx-auto px-4">
          {/* Search and the fields (التخصصات), on one centred row. The study-system filter («كل الأنظمة / مسجل / بث / مختلط»)
              is gone: it split a short catalogue into groups of one or two. */}
          <div className="mb-8 flex flex-col items-stretch gap-3 rounded-[28px] border border-line bg-paper p-3 shadow-sm sm:mb-10 lg:mx-auto lg:max-w-5xl lg:flex-row lg:items-center lg:justify-center lg:gap-4 lg:rounded-full lg:py-2.5 lg:pl-3 lg:pr-5">
            <div className="relative lg:w-72 lg:flex-none">
              <Search className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted-soft" size={19} />
              <input
                type="text"
                placeholder={content['courses.searchPlaceholder'] || 'ابحث عن دبلومة...'}
                aria-label={content['courses.searchPlaceholder'] || 'ابحث عن دبلومة...'}
                className="min-h-[46px] w-full rounded-full border border-line-strong bg-white pl-4 pr-11 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:ring-4 focus:ring-primary-600/10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <span aria-hidden="true" className="hidden h-7 w-px flex-none bg-line lg:block" />
            <div role="group" aria-label="المجال" className={pillRow}>
              <Pill value="All" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.all'] || 'كل المجالات'}</Pill>
              <Pill value="Therapy" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.therapy'] || 'علاج نفسي'}</Pill>
              <Pill value="Child" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.child'] || 'أطفال ومراهقين'}</Pill>
              <Pill value="Diagnosis" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.diagnosis'] || 'تشخيص'}</Pill>
              {/* 'General' is the default the API writes and the largest group on the site. */}
              <Pill value="General" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.general'] || 'عام'}</Pill>
            </div>
          </div>

          {/* Results */}
          {filteredCourses.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredCourses.map(course => (
                <CourseCard key={course.id} course={course} currency={currency} />
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-line bg-paper px-5 py-16 text-center">
              <Search size={28} className="mx-auto mb-3 text-muted-faint" />
              <p className="text-lg font-bold text-muted-body">{content['courses.emptyState'] || 'لا توجد كورسات مطابقة لبحثك.'}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Courses;

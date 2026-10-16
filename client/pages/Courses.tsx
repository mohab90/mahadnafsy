import React, { useState } from 'react';
import { Filter, Search, BookOpen, Users, Play, Award } from 'lucide-react';
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
      className={`min-h-[44px] flex-none whitespace-nowrap rounded-full border px-5 text-[15px] font-extrabold transition ${on ? 'border-ink bg-ink text-white shadow-lg' : 'border-line bg-paper text-muted-strong hover:border-ink/30'}`}
    >
      {children}
    </button>
  );
};

const pillRow = '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0';

const Courses: React.FC = () => {
  const { courses, content, currency } = useSiteData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  useSeo({ title: 'الدبلومات والكورسات | معهد الدراسات النفسية', path: '/courses', description: 'دبلومات معتمدة في الصحة النفسية والعلاج النفسي — برامج تدريبية بشهادات موثقة من معهد الدراسات النفسية.' });

  const filteredCourses = courses.filter(course => {
    const matchesSearch = (course.title || '').includes(searchTerm) || (course.description || '').includes(searchTerm);
    const matchesType = selectedType === 'All' || course.type === selectedType;
    const matchesCategory = selectedCategory === 'All' || course.category === selectedCategory;
    return matchesSearch && matchesType && matchesCategory;
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
          {/* Search and filters */}
          <div className="mb-8 space-y-4 sm:mb-10">
            <div className="relative lg:max-w-md">
              <Search className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted-soft" size={20} />
              <input
                type="text"
                placeholder={content['courses.searchPlaceholder'] || 'ابحث عن دبلومة...'}
                aria-label={content['courses.searchPlaceholder'] || 'ابحث عن دبلومة...'}
                className="min-h-[52px] w-full rounded-2xl border border-line-strong bg-paper pl-4 pr-12 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <p className="flex items-center gap-1.5 text-[13px] font-bold text-muted-strong">
              <Filter size={15} className="text-gold-deep" />
              {content['courses.filterLabel'] || 'تصفية حسب:'}
            </p>

            <div role="group" aria-label="نظام الدراسة" className={pillRow}>
              <Pill value="All" current={selectedType} onPick={setSelectedType}>{content['courses.types.all'] || 'كل الأنظمة'}</Pill>
              <Pill value="Recorded" current={selectedType} onPick={setSelectedType}>{content['courses.types.recorded'] || 'مسجل'}</Pill>
              <Pill value="Live" current={selectedType} onPick={setSelectedType}>{content['courses.types.live'] || 'بث مباشر'}</Pill>
              <Pill value="Mix" current={selectedType} onPick={setSelectedType}>{content['courses.types.mix'] || 'مختلط'}</Pill>
            </div>

            <div role="group" aria-label="التخصص" className={pillRow}>
              <Pill value="All" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.all'] || 'كل التخصصات'}</Pill>
              <Pill value="Therapy" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.therapy'] || 'علاج نفسي'}</Pill>
              <Pill value="Child" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.child'] || 'أطفال ومراهقين'}</Pill>
              <Pill value="Diagnosis" current={selectedCategory} onPick={setSelectedCategory}>{content['courses.categories.diagnosis'] || 'تشخيص'}</Pill>
              {/* 'General' is the default the API writes and the largest group
                  on the site, and it was the one category with no way to
                  filter to it. */}
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

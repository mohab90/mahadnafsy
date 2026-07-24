import React, { useState, useEffect } from 'react';
import { Filter, Search, BookOpen, Users, Play, Award } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import CourseCard from '../components/CourseCard';

const Courses: React.FC = () => {
  const { courses, content, currency } = useSiteData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  useEffect(() => { document.title = 'الدبلومات والكورسات | معهد الدراسات النفسية'; }, []);

  const filteredCourses = courses.filter(course => {
    const matchesSearch = (course.title || '').includes(searchTerm) || (course.description || '').includes(searchTerm);
    const matchesType = selectedType === 'All' || course.type === selectedType;
    const matchesCategory = selectedCategory === 'All' || course.category === selectedCategory;
    return matchesSearch && matchesType && matchesCategory;
  });

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900 text-white py-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-700 rounded-full blur-[120px] opacity-20"></div>
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-800 rounded-full blur-[100px] opacity-15"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-blue-600/30 border border-blue-400/30 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
            <BookOpen size={14} className="text-blue-300" />
            <span>{courses.length} برنامج تدريبي متاح</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">{content['courses.title'] || 'الدبلومات والبرامج التدريبية'}</h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
            {content['courses.subtitle'] || 'استثمر في مستقبلك المهني مع أحدث البرامج التدريبية في علم النفس'}
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-8">
            {[
              { icon: BookOpen, label: 'دبلومات معتمدة', sub: 'شهادات موثقة' },
              { icon: Users, label: '12,000+ طالب', sub: 'من الوطن العربي' },
              { icon: Play, label: 'محاضرات تفاعلية', sub: 'تسجيلات حصرية' },
              { icon: Award, label: 'تميز أكاديمي', sub: 'معايير دولية' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 text-sm">
                <Icon size={18} className="text-blue-300" />
                <div className="text-right">
                  <div className="font-bold text-white">{label}</div>
                  <div className="text-gray-400 text-xs">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-10">
        {/* Filters and Search */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            {/* Search */}
            <div className="relative w-full md:w-1/3">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input 
                type="text" 
                placeholder={content['courses.searchPlaceholder'] || 'ابحث عن دبلومة...'} 
                className="w-full pr-10 pl-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Filters Group */}
            <div className="flex flex-wrap gap-4 w-full md:w-auto">
              <div className="flex items-center gap-2">
                <Filter size={18} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-700">{content['courses.filterLabel'] || 'تصفية حسب:'}</span>
              </div>
              
              <select 
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
              >
                <option value="All">{content['courses.types.all'] || 'كل الأنظمة'}</option>
                <option value="Recorded">{content['courses.types.recorded'] || 'مسجل'}</option>
                <option value="Live">{content['courses.types.live'] || 'بث مباشر'}</option>
                <option value="Mix">{content['courses.types.mix'] || 'مختلط'}</option>
              </select>

              <select 
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="All">{content['courses.categories.all'] || 'كل التخصصات'}</option>
                <option value="Therapy">{content['courses.categories.therapy'] || 'علاج نفسي'}</option>
                <option value="Child">{content['courses.categories.child'] || 'أطفال ومراهقين'}</option>
                <option value="Diagnosis">{content['courses.categories.diagnosis'] || 'تشخيص'}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Results */}
        {filteredCourses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredCourses.map(course => (
              <CourseCard key={course.id} course={course} currency={currency} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-xl text-gray-500">{content['courses.emptyState'] || 'لا توجد كورسات مطابقة لبحثك.'}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Courses;
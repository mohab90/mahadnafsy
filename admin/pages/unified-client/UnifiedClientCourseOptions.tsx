import React, { useMemo } from 'react';
import type { Bundle, Course } from '../../types';

type Props = {
  bundles: Bundle[];
  courses: Course[];
};

export const UnifiedClientCourseOptions: React.FC<Props> = ({ bundles, courses }) => {
  const bundledCourseIds = useMemo(
    () => new Set(bundles.flatMap(bundle => bundle.courses.map(course => course.id))),
    [bundles],
  );

  return (
    <>
      {bundles.map(bundle => (
        <optgroup key={bundle.id} label={`📌 ${bundle.title}`}>
          {bundle.courses.map(course => (
            <option key={course.id} value={course.id}>{course.title}</option>
          ))}
        </optgroup>
      ))}
      <optgroup label="🎓 الكورسات الفردية">
        {courses.filter(course => !bundledCourseIds.has(course.id)).map(course => (
          <option key={course.id} value={course.id}>{course.title}</option>
        ))}
      </optgroup>
    </>
  );
};

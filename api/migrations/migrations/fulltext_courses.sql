ALTER TABLE courses ADD FULLTEXT INDEX ft_courses_title_desc (title, description);

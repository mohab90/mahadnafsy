import type { Course, Bundle, Therapist, TestimonialItem } from './types';

// What the panel and the site hold before the API has answered, and when it has nothing to answer with: nothing.
//
// This file used to carry four invented therapists (a doctor's name, her bio, her price, her booking hours) and three invented testimonials — in BOTH apps, as
// the starting state — so a visitor saw them for as long as the API took, and for good wherever the database held no real ones (the loaders only replace a list
// that came back non-empty). A seed that looks like content is content. 5 Nov 2026: empty, like the courses and the tracks were.
export const COURSES: Course[] = [];
export const BUNDLES: Bundle[] = [];
export const THERAPISTS: Therapist[] = [];
export const TESTIMONIALS: TestimonialItem[] = [];

import { Course, Bundle, MeetingProvider, Therapist, TherapistConsultationSettings, WeekDayKey } from './types';

const buildConsultationSettings = (
  provider: MeetingProvider,
  username: string,
  password: string,
  slotSeed: Array<{ day: WeekDayKey; startTime: string; endTime: string; label?: string }>,
  price: { EGP: number; SAR: number; USD: number },
  overrides: Partial<TherapistConsultationSettings> = {}
): TherapistConsultationSettings => ({
  enabled: true,
  sessionDurationMinutes: 50,
  sessionPrice: price,
  meetingProvider: provider,
  providerBaseUrl: provider === 'zoom' ? 'https://zoom.us/j' : provider === 'google_meet' ? 'https://meet.google.com/lookup' : 'https://meet.example.com/session',
  autoCreateMeetingLink: true,
  intakeFormUrl: '',
  bookingNotes: 'يرجى الحضور قبل الموعد بعشر دقائق والتأكد من جودة الإنترنت والخصوصية.',
  availableSlots: slotSeed.map((slot, index) => ({
    id: `${username}-slot-${index + 1}`,
    day: slot.day,
    startTime: slot.startTime,
    endTime: slot.endTime,
    timezone: 'Africa/Cairo',
    label: slot.label,
    isActive: true,
  })),
  portal: {
    username,
    password,
    temporaryPassword: false,
  },
  ...overrides,
});

export const COURSES: Course[] = [];

// No seed bundles — all data comes from the MySQL API.
// Seed data here would show fake entries before the API loads.
export const BUNDLES: Bundle[] = [];

export const THERAPISTS: Therapist[] = [
  {
    id: 't1',
    name: 'د. منى سعيد',
    title: 'استشاري العلاقات الأسرية',
    bio: 'دكتوراة في علم النفس الإكلينيكي من جامعة القاهرة. خبرة 15 عاماً في الإرشاد الزوجي والأسري. مؤلفة كتاب "أسرة سعيدة" ومحاضرة في العديد من الجامعات.',
    specialty: 'علاقات أسرية وزوجية',
    image: '',
    experience: 15,
    rating: 4.9,
    price: { EGP: 500, SAR: 150, USD: 50 },
    featured: true,
    languages: ['العربية', 'الإنجليزية'],
    focusAreas: ['العلاج الزواجي', 'حل النزاعات الأسرية', 'جلسات ما قبل الطلاق'],
    qualifications: ['دكتوراه علم النفس الإكلينيكي', 'معالج أسري معتمد', 'مشرف إكلينيكي'],
    consultationSettings: buildConsultationSettings(
      'zoom',
      'mona.saeed',
      '',  // password managed in Firestore — do NOT hardcode here
      [
        { day: 'sunday', startTime: '16:00', endTime: '16:50', label: 'جلسة مسائية' },
        { day: 'tuesday', startTime: '18:00', endTime: '18:50', label: 'جلسة زوجية' },
        { day: 'thursday', startTime: '20:00', endTime: '20:50', label: 'جلسة متابعة' },
      ],
      { EGP: 650, SAR: 190, USD: 65 }
    ),
  },
  {
    id: 't2',
    name: 'د. أحمد المهدي',
    title: 'طبيب نفسي واستشاري CBT',
    bio: 'عضو الجمعية الأمريكية للطب النفسي. متخصص في علاج اضطرابات المزاج والقلق باستخدام العلاج المعرفي السلوكي. درب أكثر من 5000 معالج في الوطن العربي.',
    specialty: 'اكتئاب وقلق',
    image: '',
    experience: 20,
    rating: 4.9,
    price: { EGP: 600, SAR: 200, USD: 60 },
    featured: true,
    languages: ['العربية', 'الإنجليزية'],
    focusAreas: ['القلق', 'الاكتئاب', 'نوبات الهلع', 'الإشراف الإكلينيكي'],
    qualifications: ['استشاري CBT', 'عضو الجمعية الأمريكية للطب النفسي'],
    consultationSettings: buildConsultationSettings(
      'google_meet',
      'ahmed.elmahdy',
      '',  // password managed in Firestore
      [
        { day: 'monday', startTime: '17:00', endTime: '17:50', label: 'جلسة تشخيص' },
        { day: 'wednesday', startTime: '19:00', endTime: '19:50', label: 'جلسة علاج' },
        { day: 'friday', startTime: '12:00', endTime: '12:50', label: 'جلسة متابعة' },
      ],
      { EGP: 800, SAR: 240, USD: 80 }
    ),
  },
  {
    id: 't3',
    name: 'أ. ريهام كمال',
    title: 'أخصائي نفسي إكلينيكي',
    bio: 'ماجستير علم النفس، متخصصة في التعامل مع صدمات الطفولة والمراهقة. معتمدة في العلاج باللعب والعلاج بالفن.',
    specialty: 'مراهقين وصدمات',
    image: '',
    experience: 7,
    rating: 4.7,
    price: { EGP: 350, SAR: 100, USD: 35 },
    languages: ['العربية'],
    focusAreas: ['صدمات الطفولة', 'العلاج بالفن', 'جلسات المراهقين'],
    qualifications: ['ماجستير علم النفس', 'معتمدة في العلاج باللعب'],
    consultationSettings: buildConsultationSettings(
      'custom',
      'reham.kamal',
      '',  // password managed in Firestore
      [
        { day: 'saturday', startTime: '15:00', endTime: '15:50', label: 'مراهقين' },
        { day: 'monday', startTime: '15:00', endTime: '15:50', label: 'صدمات' },
      ],
      { EGP: 450, SAR: 130, USD: 45 },
      { providerBaseUrl: 'https://meet.example.com/therapists/rehab-kamal' }
    ),
  },
  {
    id: 't4',
    name: 'د. سارة حسن',
    title: 'استشاري طب نفس الأطفال',
    bio: 'خبرة واسعة في تشخيص وعلاج اضطرابات الطفولة مثل التوحد وفرط الحركة. تقدم برامج إرشادية للآباء.',
    specialty: 'أطفال وتوحد',
    image: '',
    experience: 12,
    rating: 4.8,
    price: { EGP: 450, SAR: 130, USD: 45 },
    languages: ['العربية', 'الإنجليزية'],
    focusAreas: ['التوحد', 'فرط الحركة', 'إرشاد الوالدين'],
    qualifications: ['استشاري طب نفسي أطفال', 'خبير تعديل سلوك'],
    consultationSettings: buildConsultationSettings(
      'zoom',
      'sara.hassan',
      '',  // password managed in Firestore
      [
        { day: 'sunday', startTime: '13:00', endTime: '13:50', label: 'جلسة طفل' },
        { day: 'wednesday', startTime: '13:00', endTime: '13:50', label: 'إرشاد ولي أمر' },
      ],
      { EGP: 550, SAR: 160, USD: 55 }
    ),
  },
  {
    id: 't5',
    name: 'د. محمود العزازي',
    title: 'دكتوراه علم النفس العصبي',
    bio: 'خبير في القياس النفسي والتقييم العصبي. مؤلف عدة مقاييس نفسية مستخدمة في العالم العربي.',
    specialty: 'قياس نفسي وتشخيص',
    image: '',
    experience: 18,
    rating: 4.8,
    price: { EGP: 500, SAR: 150, USD: 50 },
    languages: ['العربية'],
    focusAreas: ['القياس النفسي', 'التشخيص العصبي'],
    qualifications: ['دكتوراه علم النفس العصبي', 'خبير القياس النفسي'],
    consultationSettings: {
      enabled: false,
      sessionDurationMinutes: 60,
      sessionPrice: { EGP: 500, SAR: 150, USD: 50 },
      meetingProvider: 'google_meet',
      providerBaseUrl: 'https://meet.google.com/lookup',
      autoCreateMeetingLink: true,
      intakeFormUrl: '',
      bookingNotes: 'حالياً غير متاح للحجز المباشر.',
      availableSlots: [],
      portal: {
        username: 'mahmoud.elezzazy',
        password: '',  // password managed in Firestore
        temporaryPassword: false,
      },
    },
  }
];

export const TESTIMONIALS = [
  {
    id: 1,
    name: "مروة عادل",
    role: "أخصائية نفسية",
    text: "الدبلومة كانت نقطة تحول في حياتي المهنية. المحتوى العملي قوي جداً وساعدني أبدأ شغلي الخاص بثقة.",
    image: ""
  },
  {
    id: 2,
    name: "كريم يحيى",
    role: "طالب علم نفس",
    text: "أفضل استثمار عملته هو اشتراكي في باقة المعالج النفسي. الترتيب والمنهجية وفروا عليا وقت كتير جداً.",
    image: ""
  },
  {
    id: 3,
    name: "سارة المنشاوي",
    role: "ولية أمر",
    text: "دبلومة تعديل السلوك ساعدتني جداً أفهم ابني واتعامل مع نوبات الغضب عنده. شكراً ليكم.",
    image: ""
  }
];

-- «ردود جاهزة لأشهر 10 مشاكل» (8 Oct 2026, from the suggestions the owner chose).
--
-- Ten ready answers in «مشاكل العملاء والتذاكر» (the ★ beside the reply box), for
-- what clients write about most: lectures locked, a video that will not play,
-- paid and the course not open, the password, the certificate, a payment not
-- seen, a Dokki round's time, a refund, an instalment, and a complaint about the
-- lecture. Added only where the institute has none of these titles; the desk
-- edits or deletes them like any other.
--
-- Rollback:
--   DELETE FROM support_canned_responses WHERE created_by='migration-262';

INSERT INTO support_canned_responses (id, tenant_id, title, body, category, created_by)
SELECT UUID(), t.id, x.title, x.body, x.category, 'migration-262'
  FROM tenants t
  JOIN (
    SELECT 'المحاضرات مقفولة' AS title, 'وصول للكورس' AS category,
           'أهلاً بحضرتك 🌷 المحاضرات بتتفتح على قد المدفوع من الكورس. راجعنا حسابك وفتحنا المحاضرات المستحقة — اعمل تحديث للصفحة أو اخرج وادخل تاني، ولو لسه مقفولة ابعتلنا صورة الشاشة.' AS body
    UNION ALL SELECT 'الفيديو مش بيشتغل', 'مشكلة تقنية',
           'أهلاً بحضرتك 🌷 جرب: (1) تحديث الصفحة، (2) متصفح Chrome بآخر إصدار، (3) نت تاني أو داتا الموبايل، (4) تقفل أي VPN. ولو لسه واقف ابعتلنا اسم المحاضرة وصورة الرسالة اللي بتظهر وهنحلها فوراً.'
    UNION ALL SELECT 'دفعت والكورس مش مفتوح', 'وصول للكورس',
           'أهلاً بحضرتك 🌷 الدفعة بتتراجع من الحسابات وبعدها الكورس بيتفتح تلقائي — غالباً خلال ساعات العمل نفس اليوم. ابعتلنا صورة إيصال التحويل ورقم العملية ونأكدهالك على طول.'
    UNION ALL SELECT 'نسيت الباسورد / مش عارف أدخل', 'مشكلة تقنية',
           'أهلاً بحضرتك 🌷 الدخول برقم الموبايل اللي اتسجلت بيه. من صفحة الدخول دوس «نسيت كلمة السر» وهيوصلك كود. لو الرقم اتغير قولنا الرقم الجديد ونحدّثه في حسابك.'
    UNION ALL SELECT 'الشهادة', 'شهادات',
           'أهلاً بحضرتك 🌷 شهادة المعهد مجانية وبتطلع تلقائي لما تكمل 90% من فلوس الكورس، وتقدر تحمّلها من حسابك على الموقع. الشهادات الإضافية (البورد الأمريكي وغيرها) بنبدأ فيها بعد تأكيد الدفع وبنبلغك بكل خطوة.'
    UNION ALL SELECT 'الدفعة مش ظاهرة في حسابي', 'مدفوعات وفواتير',
           'أهلاً بحضرتك 🌷 ابعتلنا صورة إيصال التحويل والمبلغ والتاريخ، وهنراجعها مع الحسابات ونثبتها على حسابك في نفس اليوم.'
    UNION ALL SELECT 'مواعيد الروند في الدقي', 'عام',
           'أهلاً بحضرتك 🌷 مواعيد الروند (اليوم والساعة والقاعة) بتوصلك من فرع الدقي، ولو في تأجيل بنبلغك قبلها. لو عايز تنقل لروند تاني قولنا والفرع هيرتبلك أقرب ميعاد.'
    UNION ALL SELECT 'طلب استرداد', 'طلب استرداد',
           'أهلاً بحضرتك 🌷 وصلنا طلبك وهيتراجع من الإدارة حسب سياسة الاسترداد وعدد المحاضرات اللي اتحضرت. هنكلمك خلال يومين عمل بالقرار.'
    UNION ALL SELECT 'القسط / المتبقي', 'مدفوعات وفواتير',
           'أهلاً بحضرتك 🌷 المتبقي عليك بيظهر في حسابك على الموقع، وتقدر تدفعه على نفس وسائل الدفع. أول ما الدفعة تتأكد المحاضرات الباقية بتتفتح.'
    UNION ALL SELECT 'شكوى من المحاضرة أو المحاضر', 'شكوى',
           'أهلاً بحضرتك 🌷 متأسفين جداً إن التجربة مكانتش زي ما تستاهل. سجلنا الشكوى ووصلت للإدارة والمسئول عن الكورس، وهنكلمك في خلال 24 ساعة بالحل.'
  ) x
 WHERE NOT EXISTS (SELECT 1 FROM support_canned_responses c WHERE c.tenant_id = t.id AND c.title = x.title);

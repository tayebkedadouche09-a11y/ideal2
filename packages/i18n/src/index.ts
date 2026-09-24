/**
 * i18n — spec §1: Languages FR / AR / EN, RTL supported. Currency DZD.
 * Catalogs are flat keys; Arabic is RTL, French/English LTR.
 */
export const LOCALES = ['fr', 'ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

export function dir(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

type Dict = Record<string, string>;

const en: Dict = {
  'app.name': 'Company OS',
  'nav.dashboard': 'Dashboard',
  'nav.clients': 'Clients',
  'nav.suppliers': 'Suppliers',
  'nav.contracts': 'Contracts',
  'nav.quotes': 'Quotes',
  'nav.projects': 'Projects',
  'nav.planning': 'Planning',
  'nav.stock': 'Stock',
  'nav.purchasing': 'Purchasing',
  'nav.employees': 'Employees',
  'nav.teams': 'Teams',
  'nav.vehicles': 'Vehicles',
  'nav.equipment': 'Equipment',
  'nav.finance': 'Finance',
  'nav.documents': 'Documents',
  'nav.communications': 'Communications',
  'nav.ai': 'AI Company Brain',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',
  'nav.audit': 'Audit',
  'auth.login': 'Sign in',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'dash.activeProjects': 'Active projects',
  'dash.delayedProjects': 'Delayed projects',
  'dash.unpaidInvoices': 'Unpaid invoices',
  'dash.stockAlerts': 'Stock alerts',
  'dash.dailyBriefing': 'Daily briefing',
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.create': 'Create',
  'common.add': 'Add',
  'common.actions': 'Actions',
  'common.status': 'Status',
  'common.name': 'Name',
  'common.date': 'Date',
  'common.amount': 'Amount',
  'common.client': 'Client',
  'common.project': 'Project',
  'common.total': 'Total',
  'common.search': 'Search',
  'common.logout': 'Sign out',
  'common.none': 'No data yet',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'nav.notifications': 'Notifications',
  'nav.new': 'New',
};

const fr: Dict = {
  'app.name': 'Company OS',
  'nav.dashboard': 'Tableau de bord',
  'nav.clients': 'Clients',
  'nav.suppliers': 'Fournisseurs',
  'nav.contracts': 'Contrats',
  'nav.quotes': 'Devis',
  'nav.projects': 'Chantiers',
  'nav.planning': 'Planification',
  'nav.stock': 'Stock',
  'nav.purchasing': 'Achats',
  'nav.employees': 'Employés',
  'nav.teams': 'Équipes',
  'nav.vehicles': 'Véhicules',
  'nav.equipment': 'Équipements',
  'nav.finance': 'Finance',
  'nav.documents': 'Documents',
  'nav.communications': 'Communications',
  'nav.ai': 'Cerveau IA',
  'nav.reports': 'Rapports',
  'nav.settings': 'Paramètres',
  'nav.audit': 'Audit',
  'auth.login': 'Se connecter',
  'auth.username': 'Identifiant',
  'auth.password': 'Mot de passe',
  'dash.activeProjects': 'Chantiers actifs',
  'dash.delayedProjects': 'Chantiers en retard',
  'dash.unpaidInvoices': 'Factures impayées',
  'dash.stockAlerts': 'Alertes stock',
  'dash.dailyBriefing': 'Briefing quotidien',
  'common.loading': 'Chargement…',
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.create': 'Créer',
  'common.add': 'Ajouter',
  'common.actions': 'Actions',
  'common.status': 'Statut',
  'common.name': 'Nom',
  'common.date': 'Date',
  'common.amount': 'Montant',
  'common.client': 'Client',
  'common.project': 'Chantier',
  'common.total': 'Total',
  'common.search': 'Rechercher',
  'common.logout': 'Se déconnecter',
  'common.none': 'Aucune donnée',
  'common.confirm': 'Confirmer',
  'common.close': 'Fermer',
  'nav.notifications': 'Notifications',
  'nav.new': 'Nouveau',
};

const ar: Dict = {
  'app.name': 'نظام الشركة',
  'nav.dashboard': 'لوحة القيادة',
  'nav.clients': 'العملاء',
  'nav.suppliers': 'الموردون',
  'nav.contracts': 'العقود',
  'nav.quotes': 'عروض الأسعار',
  'nav.projects': 'الورشات',
  'nav.planning': 'الجدولة',
  'nav.stock': 'المخزون',
  'nav.purchasing': 'المشتريات',
  'nav.employees': 'الموظفون',
  'nav.teams': 'الفرق',
  'nav.vehicles': 'الآليات',
  'nav.equipment': 'المعدات',
  'nav.finance': 'المالية',
  'nav.documents': 'المستندات',
  'nav.communications': 'الاتصالات',
  'nav.ai': 'عقل الشركة الذكي',
  'nav.reports': 'التقارير',
  'nav.settings': 'الإعدادات',
  'nav.audit': 'التدقيق',
  'auth.login': 'تسجيل الدخول',
  'auth.username': 'المعرّف',
  'auth.password': 'كلمة المرور',
  'dash.activeProjects': 'ورشات نشطة',
  'dash.delayedProjects': 'ورشات متأخرة',
  'dash.unpaidInvoices': 'فواتير غير مسددة',
  'dash.stockAlerts': 'تنبيهات المخزون',
  'dash.dailyBriefing': 'إحاطة يومية',
  'common.loading': 'جارٍ التحميل…',
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.create': 'إنشاء',
  'common.add': 'إضافة',
  'common.actions': 'إجراءات',
  'common.status': 'الحالة',
  'common.name': 'الاسم',
  'common.date': 'التاريخ',
  'common.amount': 'المبلغ',
  'common.client': 'العميل',
  'common.project': 'الورشة',
  'common.total': 'المجموع',
  'common.search': 'بحث',
  'common.logout': 'تسجيل الخروج',
  'common.none': 'لا توجد بيانات',
  'common.confirm': 'تأكيد',
  'common.close': 'إغلاق',
  'nav.notifications': 'الإشعارات',
  'nav.new': 'جديد',
};

export const catalogs: Record<Locale, Dict> = { en, fr, ar };

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let text = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, String(v));
  }
  return text;
}

export function formatMoney(amount: number, locale: Locale = 'fr'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-US' : 'fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 2,
  }).format(amount);
}

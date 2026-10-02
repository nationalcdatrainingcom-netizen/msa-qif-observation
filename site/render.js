// ════════════════════════════════════════════════════════════════════
// PUBLIC MARKETING SITE (mentorsuccessacademy.com)
// ════════════════════════════════════════════════════════════════════
// Each topic has its own page so it can answer its own question in search
// and AI. A page is a body in site/pages/ wrapped in site/layout.html, with
// its own title, description, canonical URL and structured data.
//
// Pages are built once at startup. Placeholders a body can use:
//   {{weeks}}  the 12 weeks, from training-curriculum.js (program page)
//   {{faq}}    the questions in site/faq.js (FAQ page)
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const CURRICULUM = require('../training-curriculum');
const FAQ = require('./faq');

// The one-sentence description of MSA. Use it word for word wherever MSA is
// introduced (home page, structured data, llms.txt) so AI quotes it the same way.
// When the site's content was last reviewed, shown in every page's footer
// ("Updated October 2026") and as dateModified in the structured data.
// Fresh dates help AI tools trust a page: review the site and bump this
// every few months. Format: YYYY-MM.
const SITE_UPDATED = '2026-10';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const updatedLabel = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const STANDARD_DESCRIPTION = "Mentor Success Academy (MSA) is a 12-week mentor training program that teaches experienced preschool teachers how to mentor and coach other early childhood teachers, built on MSA's LEAP framework.";

const DOMAINS = [
  { n: 1, name: 'Emotional Climate & Responsiveness', weeks: '1–4',
    about: 'Mentors learn to coach the emotional side of the classroom: warmth, responsiveness, seeing the child’s perspective and keeping every child emotionally safe.' },
  { n: 2, name: 'Classroom Organization', weeks: '5–8',
    about: 'Mentors learn to coach how a classroom runs: guiding behavior, protecting learning time, keeping children engaged and designing a space that supports learning.' },
  { n: 3, name: 'Instructional Support', weeks: '9–12',
    about: 'Mentors learn to coach how teachers build thinking and language: concept development, feedback that moves learning forward, rich language and higher-order questions.' }
];

// Order here is the order in the nav and footer.
const PAGES = [
  {
    key: 'home', path: '/', file: 'home.html',
    title: 'Mentor Training for Preschool Teachers | Mentor Success Academy',
    description: 'Mentor training for preschool teachers: a 12-week program that teaches experienced early childhood teachers to mentor, coach and retain great educators. Free research trial begins January 2027.'
  },
  {
    key: 'how', path: '/how-it-works', file: 'how-it-works.html', nav: 'How It Works',
    title: 'How Mentor Success Academy Works | Mentor Training for Preschool Teachers',
    description: 'How Mentor Success Academy works: each week for 12 weeks, an experienced teacher completes a short online module, then meets a mentee for 30–45 minutes to practice it. The skills stay with the mentor.'
  },
  {
    key: 'program', path: '/program', file: 'program.html', nav: 'The Program',
    title: 'The 12-Week Program, Week by Week | Mentor Success Academy',
    description: 'The Mentor Success Academy program week by week: Emotional Climate & Responsiveness (weeks 1–4), Classroom Organization (weeks 5–8) and Instructional Support (weeks 9–12).'
  },
  {
    key: 'founders', path: '/founders', file: 'founders.html', nav: 'About the Founders',
    title: 'About the Founders | Mentor Success Academy',
    description: "Mentor Success Academy was co-founded by Mary Wardlaw, Ed.S., MBA, founder of The Children's Center, and Rebecca Munlyn, founder and CEO of Inspired Growth, LLC."
  },
  {
    key: 'research', path: '/research-trial', file: 'research-trial.html', nav: 'Free Research Trial',
    title: 'Free Research Trial, Beginning January 2027 | Mentor Success Academy',
    description: "Mentor Success Academy's free 3-month research trial begins January 2027. Mentors receive MSA's mentor training, valued at $1,200, at no cost. See who can take part and apply.",
    scripts: ['/js/research-trial.js']
  },
  {
    key: 'membership', path: '/membership', file: 'membership.html', nav: 'Center Membership',
    title: 'Center Membership | Mentor Success Academy',
    description: "A Mentor Success Academy center membership gives your program full access to MSA's mentor training, certification and tools, priced monthly per mentor. Start any time and cancel online.",
    scripts: ['/js/membership.js']
  },
  {
    key: 'faq', path: '/faq', file: 'faq.html', nav: 'FAQ',
    title: 'Frequently Asked Questions | Mentor Success Academy',
    description: "Answers to common questions about Mentor Success Academy: who takes the training, time each week, MSA's LEAP framework, certification, the research trial and center membership."
  }
];

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function weeksHtml() {
  return DOMAINS.map(d => {
    const weeks = CURRICULUM.filter(m => m.domain === d.n).sort((a, b) => a.week - b.week);
    return `
      <div class="domain-block" id="focus-area-${d.n}">
        <span class="eyebrow">Weeks ${d.weeks}</span>
        <h2>${esc(d.name)}</h2>
        <p>${esc(d.about)}</p>
        <ol class="weeks">
${weeks.map(m => `          <li class="week" id="week-${m.week}">
            <span class="week-tag">Week ${m.week}</span>
            <h3>${esc(m.title)}</h3>
            <p>${esc(m.focus)}</p>
          </li>`).join('\n')}
        </ol>
      </div>`;
  }).join('\n');
}

function faqHtml() {
  return FAQ.map(f => `
        <details>
          <summary>${esc(f.q)}</summary>
          <p>${esc(f.a)}</p>
        </details>`).join('');
}

function structuredData(page, siteUrl) {
  const id = frag => `${siteUrl}/#${frag}`;
  const url = siteUrl + (page.path === '/' ? '/' : page.path);
  const organization = {
    '@type': 'Organization',
    '@id': id('organization'),
    name: 'Mentor Success Academy',
    alternateName: 'MSA',
    url: siteUrl + '/',
    logo: `${siteUrl}/img/msa-logo-light.png`,
    email: 'info@mentorsuccessacademy.com',
    description: STANDARD_DESCRIPTION,
    disambiguatingDescription: "Mentor Success Academy is a mentor training program for early childhood (preschool) teachers in the United States. LEAP (Leadership Expression Assessment Profile) is the framework inside Mentor Success Academy's training. MSA is not affiliated with any other program that uses the name LEAP, including youth mentoring programs.",
    founder: [
      { '@type': 'Person', '@id': id('mary-wardlaw'), name: 'Mary Wardlaw', url: `${siteUrl}/founders` },
      { '@type': 'Person', '@id': id('rebecca-munlyn'), name: 'Rebecca Munlyn', url: `${siteUrl}/founders` }
    ]
  };
  const webPage = {
    '@type': page.key === 'faq' ? 'FAQPage' : page.key === 'founders' ? 'AboutPage' : 'WebPage',
    '@id': url + '#webpage',
    url,
    name: page.title,
    description: page.description,
    isPartOf: { '@type': 'WebSite', '@id': id('website'), name: 'Mentor Success Academy', url: siteUrl + '/' },
    about: { '@id': id('organization') },
    primaryImageOfPage: `${siteUrl}/img/og-image.jpg`,
    dateModified: SITE_UPDATED
  };
  if (page.key !== 'home') {
    webPage.breadcrumb = {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl + '/' },
        { '@type': 'ListItem', position: 2, name: page.nav, item: url }
      ]
    };
  }
  const graph = [organization, webPage];

  const course = {
    '@type': 'Course',
    '@id': id('course'),
    name: 'Mentor Success Academy Mentor Training for Preschool Teachers',
    url: `${siteUrl}/program`,
    description: "A 12-week mentor training program for experienced early childhood teachers, built on MSA's LEAP framework (Leadership Expression Assessment Profile). Mentors complete 12 weekly modules across three focus areas (Emotional Climate & Responsiveness; Classroom Organization; Instructional Support), meet with a mentee for 30-45 minutes each week, and can earn the annual MSA Certified Mentor credential.",
    provider: { '@id': id('organization') },
    inLanguage: 'en',
    timeRequired: 'P12W',
    audience: {
      '@type': 'EducationalAudience',
      educationalRole: 'Mentor teachers in early childhood programs serving children ages 2.5-5'
    },
    teaches: [
      'Mentoring early childhood teachers',
      'Classroom observation',
      'Giving feedback to teachers',
      'Coaching teachers with different working styles'
    ],
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'Online',
      courseSchedule: { '@type': 'Schedule', repeatFrequency: 'P1W', repeatCount: 12 }
    }
  };
  if (page.key === 'home' || page.key === 'how') graph.push(course);
  if (page.key === 'program') {
    course.syllabusSections = CURRICULUM.slice().sort((a, b) => a.week - b.week).map(m => ({
      '@type': 'Syllabus',
      name: `Week ${m.week}: ${m.title}`,
      description: m.focus
    }));
    graph.push(course);
  }
  if (page.key === 'founders') {
    graph.push({
      '@type': 'Person',
      '@id': id('mary-wardlaw'),
      name: 'Mary Wardlaw',
      honorificSuffix: 'Ed.S., MBA',
      jobTitle: 'Co-founder, Mentor Success Academy',
      image: `${siteUrl}/img/mary.jpg`,
      url: `${siteUrl}/founders`,
      // Her own bio site
      sameAs: ['https://mary-wardlaw.com'],
      worksFor: [
        { '@id': id('organization') },
        { '@type': 'Organization', name: "The Children's Center" },
        { '@type': 'Organization', name: 'National CDA Training' }
      ],
      knowsAbout: ['Early childhood education', 'Teacher mentoring', 'Teacher retention', 'Child Development Associate (CDA) credential'],
      description: "Early childhood educator since 1992, founder of The Children's Center (2002) and National CDA Training (2019), and Ph.D. student in Early Childhood Education researching the training, mentoring and retention of early childhood teachers."
    }, {
      '@type': 'Person',
      '@id': id('rebecca-munlyn'),
      name: 'Rebecca Munlyn',
      jobTitle: 'Co-founder, Mentor Success Academy; Founder and CEO, Inspired Growth, LLC',
      image: `${siteUrl}/img/rebecca.jpg`,
      url: `${siteUrl}/founders`,
      worksFor: [
        { '@id': id('organization') },
        { '@type': 'Organization', name: 'Inspired Growth, LLC', url: 'https://inspiredgrowthllc.com' }
      ],
      alumniOf: [
        { '@type': 'CollegeOrUniversity', name: 'Georgia Institute of Technology' },
        { '@type': 'CollegeOrUniversity', name: 'Columbus State University' }
      ],
      knowsAbout: ['Leadership development', 'Team development', 'Coaching', 'Adult learning'],
      description: 'Leader and team development consultant with more than 20 years of coaching and consulting experience in corporate and nonprofit organizations.'
    });
  }
  if (page.key === 'faq') {
    webPage.mainEntity = FAQ.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }));
  }
  // "<" can't appear raw inside a <script> block
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2).replace(/</g, '\\u003c');
}

function render(siteUrl) {
  const layout = fs.readFileSync(path.join(__dirname, 'layout.html'), 'utf8');
  const out = {};
  for (const page of PAGES) {
    const url = siteUrl + (page.path === '/' ? '/' : page.path);
    const links = PAGES.filter(p => p.nav).map(p => ({ p, current: p.key === page.key ? ' aria-current="page"' : '' }));
    let body = fs.readFileSync(path.join(__dirname, 'pages', page.file), 'utf8')
      .replace('{{weeks}}', weeksHtml())
      .replace('{{faq}}', faqHtml());
    const fill = {
      title: esc(page.title),
      description: esc(page.description),
      url: esc(url),
      siteUrl: esc(siteUrl),
      updated: `<time datetime="${SITE_UPDATED}">${updatedLabel(SITE_UPDATED)}</time>`,
      jsonld: structuredData(page, siteUrl),
      nav: links.map(({ p, current }) => `      <a href="${p.path}"${current}>${esc(p.nav)}</a>`).join('\n'),
      footerNav: links.map(({ p }) => `        <a href="${p.path}">${esc(p.nav)}</a>`).join('\n'),
      scripts: (page.scripts || []).map(s => `<script src="${s}"></script>`).join('\n'),
      body
    };
    // One pass, so text inside a filled value is never treated as a placeholder
    out[page.key] = layout.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
  }
  return out;
}

module.exports = { PAGES, STANDARD_DESCRIPTION, render };

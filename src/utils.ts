export type Entry = {
  uId: string;
  text: string;
  section: string;
  source: string;
  charCount: number;
  isAssistant: boolean;
  score: number;
  sentiment: string;
  topic: string;
  people: string[];
  textLower: string;
  timestamp?: number;
  aiReason?: string;
  aiDetailedReason?: string;
  aiProof?: string;
  isHidden?: boolean;
  removalReason?: 'Manual' | 'AI-Reply' | 'Short' | 'Low-Score' | 'Keyword';
  matchedKeywords?: string[];
};

export const TOPIC_KEYWORDS: Record<string, string[]> = {
  childhood: ['child', 'childhood', 'young', 'kid', 'school', 'grew up', 'teenager', 'boy', 'girl', 'adolescent', 'puberty', 'playground', 'primary', 'elementary', 'parents raised', 'mom and dad', 'first memory', 'as a kid', 'little kid', 'little boy', 'little girl'],
  family: ['mother', 'father', 'sister', 'brother', 'dad', 'mom', 'mum', 'papa', 'grandma', 'grandpa', 'grandmother', 'grandfather', 'uncle', 'aunt', 'cousin', 'wife', 'husband', 'family', 'parents', 'relative', 'sibling', 'in-law'],
  love: ['love', 'relationship', 'girlfriend', 'boyfriend', 'wife', 'husband', 'partner', 'kiss', 'romance', 'dating', 'heartbreak', 'fell in love', 'broke up', 'marriage', 'wedding', 'divorce', 'ex', 'crush', 'attraction'],
  work: ['job', 'work', 'career', 'boss', 'office', 'project', 'business', 'company', 'fired', 'hired', 'salary', 'colleague', 'client', 'startup', 'promotion', 'unemployed', 'freelance', 'interview'],
  health: ['hospital', 'sick', 'illness', 'health', 'doctor', 'medicine', 'therapy', 'therapist', 'depression', 'anxiety', 'medication', 'diagnosis', 'treatment', 'recovery', 'surgery', 'panic attack', 'breakdown', 'mental health', 'chronic'],
  loss: ['death', 'died', 'funeral', 'grief', 'grieving', 'loss', 'passed away', 'mourning', 'cemetery', 'gone forever', 'miss them', 'never came back', 'last time I saw', 'overdose'],
  growth: ['learned', 'realized', 'changed', 'became', 'started', 'decided', 'turned point', 'epiphany', 'breakthrough', 'grew', 'matured', 'perspective', 'understood', 'transformed', 'found myself'],
  adventure: ['travel', 'moved', 'trip', 'adventure', 'new city', 'new country', 'explore', 'road trip', 'backpacking', 'abroad', 'emigrated', 'immigrated', 'relocated', 'left home', 'arrived'],
  identity: ['who I am', 'identity', 'culture', 'religion', 'faith', 'sexuality', 'gay', 'queer', 'trans', 'race', 'ethnicity', 'nationality', 'immigrant', 'outsider', 'belonging', 'accepted', 'different'],
};

const POSITIVE_WORDS = new Set(['love', 'happy', 'joy', 'wonderful', 'beautiful', 'amazing', 'great', 'good', 'best', 'hope', 'proud', 'grateful', 'excited', 'lucky', 'blessed', 'peace', 'warm', 'comfort', 'laugh', 'smile', 'delight', 'celebrate', 'achieve', 'success', 'thrive', 'content', 'safe', 'belonged']);
const NEGATIVE_WORDS = new Set(['hate', 'sad', 'angry', 'terrible', 'awful', 'bad', 'worst', 'fear', 'pain', 'hurt', 'broken', 'lost', 'alone', 'scared', 'depressed', 'anxious', 'trauma', 'abuse', 'violence', 'shame', 'guilt', 'regret', 'failure', 'humiliated', 'betrayed', 'abandoned', 'hopeless', 'desperate', 'cry', 'crying', 'cried', 'tears', 'numb', 'dead inside', 'worthless', 'ugly', 'stupid']);
const STORY_ARC_WORDS = ['then', 'after', 'because', 'until', 'finally', 'but then', 'so i', 'which meant', "that's when", 'moment', 'suddenly', 'realised', 'realized', 'turned out', 'it was', 'I knew', 'I felt', 'everything changed'];
const FIRST_PERSON = ['i was', 'i am', 'i have', 'i had', 'i felt', 'i feel', 'i knew', 'i know', 'i remember', 'i went', 'i came', 'i said', 'i thought', 'i started', 'i lived', 'i grew', 'i loved', 'i wanted', 'i tried', 'i failed', 'i cried', 'my life', 'my family', 'my mother', 'my father', 'my childhood', 'when i was'];

const _FP_RE = new RegExp(FIRST_PERSON.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
const _ARC_RE = new RegExp(STORY_ARC_WORDS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
const _MEMRE = /\b(when I was|years ago|I remember|back then|\d+ years|as a child|growing up|that summer|that night|that day|at the time)\b/gi;
const _PROPER = /\b[A-Z][a-z]{2,}\b/g;
const _DIGITS = /\b\d+\b/g;
const _SKIP_PROPER = new Set(['The', 'This', 'That', 'When', 'What', 'Where', 'Why', 'How', 'There', 'They', 'Their', 'These', 'Those']);

const _TOPIC_RE = Object.fromEntries(
  Object.entries(TOPIC_KEYWORDS).map(([t, kws]) => [t, new RegExp(kws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')])
);

export function scoreEntry(text: string) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const wc = words.length;
  if (wc < 3) return 0;
  
  let s = 0;
  const fpMatches = (lower.match(_FP_RE) || []).length;
  s += Math.min(22, fpMatches * 4);
  
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos++;
    else if (NEGATIVE_WORDS.has(w)) neg++;
  }
  s += Math.min(20, (pos + neg) * 3);
  
  const arcM = (lower.match(_ARC_RE) || []).length;
  s += Math.min(18, arcM * 4);
  
  const pn = (text.match(_PROPER) || []).filter(w => !_SKIP_PROPER.has(w)).length;
  s += Math.min(15, (pn + (text.match(_DIGITS) || []).length) * 1.5);
  
  if (wc >= 80 && wc <= 400) s += 15;
  else if (wc >= 40 && wc < 80) s += Math.round((wc / 80) * 15);
  else if (wc > 400) s += Math.max(5, 15 - Math.round((wc - 400) / 100));
  
  s += Math.min(10, (text.match(_MEMRE) || []).length * 4);
  return Math.round(Math.min(100, s));
}

export function getSentiment(text: string) {
  const words = text.toLowerCase().split(/\s+/);
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos++;
    else if (NEGATIVE_WORDS.has(w)) neg++;
  }
  const t = pos + neg;
  if (!t) return 'neutral';
  const r = (pos - neg) / t;
  return r > 0.25 ? 'positive' : r < -0.25 ? 'negative' : 'mixed';
}

export function detectTopics(text: string) {
  for (const [topic, re] of Object.entries(_TOPIC_RE)) {
    if (re.test(text)) return topic;
  }
  return 'other';
}

export function detectPeopleInText(text: string) {
  const p = new Set<string>();
  const patterns = [
    /\bmy (?:friend|sister|brother|mother|father|dad|mom|mum|wife|husband|boyfriend|girlfriend|partner|son|daughter|teacher|boss|therapist|doctor) ([A-Z][a-z]+)\b/g,
    /\b([A-Z][a-z]{2,}) (?:said|told|asked|called|texted|was|had|always|never)\b/g
  ];
  for (const pat of patterns) {
    for (const m of text.matchAll(pat)) p.add(m[1]);
  }
  return [...p].slice(0, 5);
}

export function extractFromText(raw: string, source: string) {
  const lines = raw.split('\n');
  const entries: any[] = [];
  let section = 'General';
  let buffer: string[] = [];
  let currentTimestamp: number | undefined;
  
  const flush = () => {
    const t = buffer.join('\n').trim();
    if (t.length > 20) {
      entries.push({
        text: t,
        section,
        source,
        charCount: t.length,
        isAssistant: false,
        timestamp: currentTimestamp
      });
    }
    buffer = [];
    currentTimestamp = undefined;
  };
  
  for (const line of lines) {
    const t = line.trim();
    
    // Try to find a date in the line
    const dateMatch = t.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (dateMatch) {
      const d = new Date(dateMatch[0]);
      if (!isNaN(d.getTime())) currentTimestamp = d.getTime();
    }

    if (/^#{1,3} /.test(t)) {
      flush();
      section = t.replace(/^#+\s*/, '').trim();
      continue;
    }
    if (t === '') {
      if (buffer.length) flush();
      continue;
    }
    buffer.push(t);
  }
  flush();
  return entries;
}

export function extractFromJSON(data: any, source: string) {
  const messages: any[] = [];
  const seen = new Set<string>();
  
  function scan(obj: any, d: number) {
    if (!obj || typeof obj !== 'object' || d > 12) return;
    if (Array.isArray(obj)) {
      obj.forEach(o => scan(o, d + 1));
      return;
    }
    const role = (obj.role || obj.sender || obj.author || '').toLowerCase();
    const isH = role === 'human' || role === 'user';
    const isA = role === 'assistant' || role === 'ai' || role === 'claude' || role === 'bot';
    
    if (isH || isA) {
      const text = getText(obj);
      const ts = obj.timestamp || obj.created_at || obj.date || obj.time;
      let timestamp: number | undefined;
      if (ts) {
        const date = new Date(ts);
        if (!isNaN(date.getTime())) timestamp = date.getTime();
      }

      if (text && text.length > 10 && !seen.has(text)) {
        seen.add(text);
        messages.push({
          text,
          section: isA ? 'AI Response' : 'Conversation',
          source,
          charCount: text.length,
          isAssistant: isA,
          timestamp
        });
        return;
      }
    }
    Object.values(obj).forEach(v => scan(v, d + 1));
  }
  
  scan(data, 0);
  return messages;
}

function getText(m: any): string {
  if (typeof m.text === 'string') return m.text.trim();
  if (typeof m.content === 'string') return m.content.trim();
  if (Array.isArray(m.content)) return m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('\n').trim();
  return '';
}


import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const APP_NAME = "Three Great Questions";
const APP_SUBTITLE = "(and one subjective one)";

const NAVY = '#092137';
const CREAM = '#FEF8D0';
const ORANGE = '#F48717';
const RED = '#CC421A';
const GOLD = '#EEC918';
const NAVY_LIGHT = '#0e2f4f';
const NAVY_CARD = '#0d2843';

const LOGO = '/hambone.png';

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTM0iHRnP1bO58W-iwacGqB7OLZ3uyX4qK4J11lYA3J6P-VFOobsxwWg2sbEJ59EN-_-3Vpkwo63n-L/pub?gid=0&single=true&output=csv";
const TAGLINES_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTM0iHRnP1bO58W-iwacGqB7OLZ3uyX4qK4J11lYA3J6P-VFOobsxwWg2sbeeJ59EN-_-3Vpkwo63n-L/pub?gid=1892637865&single=true&output=csv";

function getSessionId() {
  let id = localStorage.getItem('tgq_session_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('tgq_session_id', id);
  }
  return id;
}

function getTodayKey() {
  const now = new Date();
  const estOffset = isDaylightSaving(now) ? 4 : 5;
  const estTime = new Date(now.getTime() - estOffset * 60 * 60 * 1000);
  const adjustedTime = new Date(estTime.getTime() - 6 * 60 * 60 * 1000);
  return adjustedTime.toISOString().slice(0, 10);
}

function isDaylightSaving(date) {
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  return date.getTimezoneOffset() < stdOffset;
}

async function fetchQuestions(sheetUrl) {
  const response = await fetch(sheetUrl);
  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inQuotes = !inQuotes;
      } else if (line[i] === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += line[i];
      }
    }
    values.push(current.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    return obj;
  }).filter(r => r.question && r.status === 'app-ready');
}

async function fetchTagline() {
  const today = getTodayKey();
  const response = await fetch(TAGLINES_URL);
  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
  const match = rows.find(r => r.tagline_date === today);
  return match ? match.tagline : null;
}

async function getTodaySet(allQuestions) {
  const today = getTodayKey();
  const trivia = allQuestions.filter(q => q.type === 'trivia' || q.type === 'multi');
  const subjective = allQuestions.filter(q => q.type === 'subjective');

  const { data: existing } = await supabase
    .from('daily_sets')
    .select('*')
    .eq('set_date', today)
    .maybeSingle();

  if (existing) {
    return [
      trivia[existing.q1_index],
      trivia[existing.q2_index],
      trivia[existing.q3_index],
      subjective[existing.subj_index]
    ];
  }

  const scheduledTrivia = trivia.filter(q => q.scheduled_date === today);
  const scheduledSubj = subjective.filter(q => q.scheduled_date === today);
  const unscheduledTrivia = trivia.filter(q => q.scheduled_date !== today);
  const scored = unscheduledTrivia
    .map((q) => ({
      ...q,
      _index: trivia.indexOf(q),
      _score: (parseFloat(q.fun) || 3) + (parseFloat(q.difficulty) || 3) + Math.random()
    }))
    .sort((a, b) => b._score - a._score);

  const scheduledWithIndex = scheduledTrivia.map(q => ({ ...q, _index: trivia.indexOf(q) }));
  const needed = 3 - scheduledWithIndex.length;
  const fillerTrivia = scored.slice(0, Math.max(needed, 0));
  const finalTrivia = [...scheduledWithIndex, ...fillerTrivia].slice(0, 3);

  const unscheduledSubj = subjective.filter(q => q.scheduled_date !== today);
  const finalSubj = scheduledSubj.length > 0
    ? { ...scheduledSubj[0], _index: subjective.indexOf(scheduledSubj[0]) }
    : { ...unscheduledSubj[Math.floor(Math.random() * unscheduledSubj.length)], _index: subjective.indexOf(unscheduledSubj[0]) };

  await supabase.from('daily_sets').insert({
    set_date: today,
    q1_index: finalTrivia[0]._index,
    q2_index: finalTrivia[1]._index,
    q3_index: finalTrivia[2]._index,
    subj_index: finalSubj._index
  });

  return [
    trivia[finalTrivia[0]._index],
    trivia[finalTrivia[1]._index],
    trivia[finalTrivia[2]._index],
    subjective[finalSubj._index]
  ];
}

async function getStreak(sessionId) {
  const { data } = await supabase
    .from('user_streaks')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data || { streak: 0, best_streak: 0, last_played_date: null };
}

async function updateStreak(sessionId) {
  const today = getTodayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('user_streaks')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  let newStreak = 1;
  let newBest = 1;

  if (existing) {
    if (existing.last_played_date === yesterdayKey) {
      newStreak = existing.streak + 1;
    } else if (existing.last_played_date === today) {
      return existing;
    }
    newBest = Math.max(existing.best_streak || 0, newStreak);
    await supabase.from('user_streaks').update({
      streak: newStreak,
      best_streak: newBest,
      last_played_date: today
    }).eq('session_id', sessionId);
  } else {
    await supabase.from('user_streaks').insert({
      session_id: sessionId,
      streak: 1,
      best_streak: 1,
      last_played_date: today
    });
  }

  return { streak: newStreak, best_streak: newBest };
}

async function saveResponse(sessionId, questions, userAnswers, score) {
  const today = getTodayKey();
  const triviaQs = questions.filter(q => q.type === 'trivia' || q.type === 'multi');
  const result = await supabase.from('user_responses').upsert({
    session_id: sessionId,
    set_date: today,
    q1_answer: Array.isArray(userAnswers[0]) ? userAnswers[0].join('|') : userAnswers[0],
    q1_accepted: triviaQs[0].type === 'multi' ? checkMultiAnswer(userAnswers[0] || [], triviaQs[0]) : checkAnswer(userAnswers[0] || '', triviaQs[0]),
    q2_answer: Array.isArray(userAnswers[1]) ? userAnswers[1].join('|') : userAnswers[1],
    q2_accepted: triviaQs[1].type === 'multi' ? checkMultiAnswer(userAnswers[1] || [], triviaQs[1]) : checkAnswer(userAnswers[1] || '', triviaQs[1]),
    q3_answer: Array.isArray(userAnswers[2]) ? userAnswers[2].join('|') : userAnswers[2],
    q3_accepted: triviaQs[2].type === 'multi' ? checkMultiAnswer(userAnswers[2] || [], triviaQs[2]) : checkAnswer(userAnswers[2] || '', triviaQs[2]),
    q4_choice: userAnswers[3],
    score
  }, { onConflict: 'session_id,set_date' });
  return result;
}

async function getTodayResponse(sessionId) {
  const today = getTodayKey();
  const { data } = await supabase
    .from('user_responses')
    .select('*')
    .eq('session_id', sessionId)
    .eq('set_date', today)
    .maybeSingle();
  return data;
}

async function getAllResponses(sessionId) {
  const { data } = await supabase
    .from('user_responses')
    .select('*')
    .eq('session_id', sessionId);
  return data || [];
}

async function getYesterdaySubjectiveWinner() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  const { data } = await supabase
    .from('user_responses')
    .select('q4_choice')
    .eq('set_date', yesterdayKey);

  if (!data || data.length === 0) return null;

  const counts = {};
  data.forEach(r => {
    if (r.q4_choice) counts[r.q4_choice] = (counts[r.q4_choice] || 0) + 1;
  });

  const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const total = data.length;
  return winner ? { choice: winner[0], count: winner[1], total, pct: Math.round((winner[1] / total) * 100) } : null;
}

function getSubjectiveComment(question, winningChoice) {
  if (!question || !winningChoice) return null;
  const options = question.options ? question.options.split('|').map(o => o.trim()) : [];
  const index = options.findIndex(o => o === winningChoice);
  if (index === -1) return null;
  const commentKey = `comment_${index + 1}`;
  return question[commentKey] || null;
}

function normalize(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

function checkAnswer(input, question) {
  const userAnswer = normalize(input);
  if (!userAnswer) return false;
  const targets = [question.answer, ...(question.aliases ? question.aliases.split('|') : [])].map(normalize);
  const isNumeric = targets.some(t => /^\d+$/.test(t));
  for (const target of targets) {
    if (isNumeric) {
      if (userAnswer === target) return true;
    } else {
      if (userAnswer === target) return true;
      if (levenshtein(userAnswer, target) <= Math.max(1, Math.floor(target.length * 0.25))) return true;
    }
  }
  return false;
}

function checkMultiAnswer(inputs, question) {
  const targets = question.answer.split('|').map(a => normalize(a.trim()));
  const userInputs = inputs.map(i => normalize(i.trim())).filter(Boolean);
  if (userInputs.length !== targets.length) return false;
  const usedTargets = new Set();
  for (const input of userInputs) {
    let matched = false;
    for (const target of targets) {
      if (usedTargets.has(target)) continue;
      const isNumeric = /^\d+$/.test(target);
      if (isNumeric ? input === target : (input === target || levenshtein(input, target) <= Math.max(1, Math.floor(target.length * 0.25)))) {
        usedTargets.add(target);
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return usedTargets.size === targets.length;
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [currentQ, setCurrentQ] = useState(0);
  const [userAnswers, setUserAnswers] = useState([]);
  const [finalAnswers, setFinalAnswers] = useState([]);
  const [questions, setQuestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [streakData, setStreakData] = useState({ streak: 0, best_streak: 0 });
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);
  const [todayResponse, setTodayResponse] = useState(null);
  const [correctPct, setCorrectPct] = useState(null);
  const [tagline, setTagline] = useState(null);
  const [yesterdayResult, setYesterdayResult] = useState(null);
  const sessionId = getSessionId();
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    async function init() {
      try {
        const [allQuestions, streak, response, allResponses, taglineText, yesterdayWinner] = await Promise.all([
          fetchQuestions(SHEET_URL),
          getStreak(sessionId),
          getTodayResponse(sessionId),
          getAllResponses(sessionId),
          fetchTagline(),
          getYesterdaySubjectiveWinner()
        ]);

        const todaySet = await getTodaySet(allQuestions);
        setQuestions(todaySet);
        setStreakData(streak);
        setTagline(taglineText);

        if (yesterdayWinner) {
          const yesterdayKey = (() => {
            const y = new Date();
            y.setDate(y.getDate() - 1);
            return y.toISOString().slice(0, 10);
          })();
          const { data: yesterdaySet } = await supabase
            .from('daily_sets')
            .select('*')
            .eq('set_date', yesterdayKey)
            .maybeSingle();

          if (yesterdaySet) {
            const subjective = allQuestions.filter(q => q.type === 'subjective');
            const yesterdaySubjQ = subjective[yesterdaySet.subj_index];
            const comment = getSubjectiveComment(yesterdaySubjQ, yesterdayWinner.choice);
            setYesterdayResult({ ...yesterdayWinner, comment, question: yesterdaySubjQ?.question });
          }
        }

        if (allResponses.length > 0) {
          const totalCorrect = allResponses.reduce((acc, r) => {
            return acc + [r.q1_accepted, r.q2_accepted, r.q3_accepted].filter(Boolean).length;
          }, 0);
          const totalAnswered = allResponses.length * 3;
          setCorrectPct(Math.round((totalCorrect / totalAnswered) * 100));
        }

        if (response) {
          setAlreadyPlayed(true);
          setTodayResponse(response);
          setFinalAnswers([
            response.q1_answer?.includes('|') ? response.q1_answer.split('|') : response.q1_answer,
            response.q2_answer?.includes('|') ? response.q2_answer.split('|') : response.q2_answer,
            response.q3_answer?.includes('|') ? response.q3_answer.split('|') : response.q3_answer,
            response.q4_choice
          ]);
        }
      } catch (e) {
        console.error('Init error:', e);
        setError('Something went wrong loading the app.');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  function handleStart() {
    setCurrentQ(0);
    setUserAnswers([]);
    setScreen('questions');
  }

  async function handleAnswer(answer) {
    const newAnswers = [...userAnswers, answer];
    setUserAnswers(newAnswers);
    if (currentQ < questions.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      const triviaQs = questions.filter(q => q.type === 'trivia' || q.type === 'multi');
      const score = triviaQs.reduce((acc, q, i) => {
        if (q.type === 'multi') return acc + (checkMultiAnswer(newAnswers[i] || [], q) ? 1 : 0);
        return acc + (checkAnswer(newAnswers[i] || '', q) ? 1 : 0);
      }, 0);
      const [, streakResult] = await Promise.all([
        saveResponse(sessionId, questions, newAnswers, score),
        updateStreak(sessionId)
      ]);
      setStreakData(streakResult);
      setFinalAnswers(newAnswers);
      setAlreadyPlayed(true);
      setTodayResponse({ score });
      setScreen('results');
    }
  }

  if (loading) return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1.25rem',
      textAlign: 'center',
      background: NAVY
    }}>
      <img src={LOGO} alt="Hambone's Trivia" style={{ width: 80, height: 80, marginBottom: 20 }} />
      <h1 style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '2rem',
        fontWeight: 400,
        marginBottom: 8,
        color: CREAM
      }}>{APP_NAME}</h1>
      <p style={{ color: CREAM, fontSize: '0.95rem', opacity: 0.6 }}>{APP_SUBTITLE}</p>
      <p style={{ color: ORANGE, fontSize: '0.9rem', marginTop: '2rem', fontStyle: 'italic' }}>
        Get ready for the best part of the day!
      </p>
    </div>
  );

  if (error) return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem', background: NAVY, minHeight: '100vh' }}>
      <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '2rem', fontWeight: 400, color: CREAM }}>{APP_NAME}</h1>
      <p style={{ color: RED, marginTop: '2rem' }}>{error}</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <div style={{ marginBottom: '2rem', textAlign: 'center', position: 'relative' }}>
        <h1 style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: '2rem',
          fontWeight: 400,
          lineHeight: 1.2,
          color: CREAM
        }}>{APP_NAME}</h1>
        <p style={{ color: CREAM, fontSize: '0.8rem', marginTop: 6, letterSpacing: '0.02em', opacity: 0.5 }}>{APP_SUBTITLE}</p>
        {screen !== 'home' && (
          <img
            src={LOGO}
            alt="Hambone's"
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 40,
              height: 40,
            }}
          />
        )}
      </div>

      {screen === 'home' && (
        <HomeScreen
          today={today}
          onStart={handleStart}
          onReview={() => setScreen('results')}
          streakData={streakData}
          alreadyPlayed={alreadyPlayed}
          todayResponse={todayResponse}
          correctPct={correctPct}
          tagline={tagline}
          yesterdayResult={yesterdayResult}
          hasResults={finalAnswers.length > 0}
        />
      )}
      {screen === 'questions' && (
        <QuestionScreen
          key={currentQ}
          question={questions[currentQ]}
          questionNumber={currentQ + 1}
          total={questions.length}
          onAnswer={handleAnswer}
        />
      )}
      {screen === 'results' && (
        <ResultsScreen
          questions={questions}
          userAnswers={finalAnswers}
          streakData={streakData}
          onHome={() => setScreen('home')}
        />
      )}
    </div>
  );
}

function HomeScreen({ today, onStart, onReview, streakData, alreadyPlayed, todayResponse, correctPct, tagline, yesterdayResult, hasResults }) {
  return (
    <div>
      <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5, marginBottom: '1rem', textAlign: 'center', letterSpacing: '0.03em' }}>{today}</p>

      <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
        <p style={{
          fontSize: '0.65rem',
          color: CREAM,
          opacity: 0.4,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 10
        }}>brought to you by</p>
        <img src={LOGO} alt="Hambone's Trivia" style={{ width: 80, height: 80 }} />
      </div>

      <div style={{
        background: NAVY_CARD,
        border: `1px solid rgba(254,248,208,0.1)`,
        borderRadius: 14,
        padding: '1.5rem',
        marginBottom: '1.25rem',
        textAlign: 'center'
      }}>
        {alreadyPlayed ? (
          <>
            <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.5, marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>today's score</p>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '3.5rem', fontWeight: 400, color: CREAM, lineHeight: 1 }}>{todayResponse.score}/3</p>
            <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5, marginTop: 10 }}>Come back tomorrow for a new set.</p>
          </>
        ) : (
          <>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.4rem', fontWeight: 400, marginBottom: 8, color: CREAM }}>Today's set is ready.</p>
            <p style={{ fontSize: '0.875rem', color: CREAM, opacity: 0.6, lineHeight: 1.6 }}>
              3 trivia questions + 1 subjective prompt.
            </p>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: '1.25rem' }}>
        <StatPill label="Current streak" value={`${streakData.streak || 0} days`} />
        <StatPill label="Longest streak" value={`${streakData.best_streak || 0} days`} />
        {correctPct !== null && (
          <StatPill label="Correct %" value={`${correctPct}%`} />
        )}
      </div>

      {yesterdayResult && (
        <div style={{
          background: NAVY_CARD,
          border: `1px solid rgba(254,248,208,0.1)`,
          borderRadius: 14,
          padding: '1.25rem',
          marginBottom: '1.25rem'
        }}>
          <p style={{ fontSize: '0.7rem', color: CREAM, opacity: 0.4, marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>yesterday's question</p>
          <p style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: 10, lineHeight: 1.5, color: CREAM }}>
            {yesterdayResult.question}
          </p>
          <p style={{ fontSize: '0.875rem', color: CREAM, opacity: 0.8 }}>
            <span style={{ fontWeight: 600, color: ORANGE }}>{yesterdayResult.pct}%</span> chose <span style={{ fontWeight: 600, color: CREAM }}>{yesterdayResult.choice}</span>
          </p>
          {yesterdayResult.comment && (
            <p style={{
              fontSize: '0.85rem',
              color: GOLD,
              fontStyle: 'italic',
              lineHeight: 1.6,
              marginTop: 10,
              paddingTop: 10,
              borderTop: `1px solid rgba(254,248,208,0.1)`
            }}>"{yesterdayResult.comment}"</p>
          )}
        </div>
      )}

      {tagline && (
        <p style={{
          fontSize: '0.875rem',
          color: CREAM,
          opacity: 0.6,
          fontStyle: 'italic',
          textAlign: 'center',
          marginBottom: '1.25rem',
          lineHeight: 1.6,
          padding: '0 0.5rem'
        }}>"{tagline}"</p>
      )}

      {!alreadyPlayed && (
        <button onClick={onStart} style={{
          width: '100%',
          padding: '1rem',
          background: ORANGE,
          color: CREAM,
          border: 'none',
          borderRadius: 12,
          fontSize: '1rem',
          fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: '0.02em',
          fontFamily: 'Inter, sans-serif',
          transition: 'opacity 0.15s'
        }}>
          Start today's questions →
        </button>
      )}

      {alreadyPlayed && hasResults && (
        <button onClick={onReview} style={{
          width: '100%',
          padding: '1rem',
          background: 'transparent',
          color: CREAM,
          border: `1.5px solid rgba(254,248,208,0.25)`,
          borderRadius: 12,
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          letterSpacing: '0.01em',
          marginTop: '0.75rem',
          fontFamily: 'Inter, sans-serif',
        }}>
          Review today's answers →
        </button>
      )}
    </div>
  );
}

function QuestionScreen({ question, questionNumber, total, onAnswer }) {
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState(null);
  const [animating, setAnimating] = useState(false);
  const isSubjective = question.type === 'subjective';
  const isTrivia = question.type === 'trivia';
  const isMulti = question.type === 'multi';
  const answerCount = parseInt(question.answer_count) || 3;
  const [multiInputs, setMultiInputs] = useState(Array(answerCount).fill(''));
  const options = question.options ? question.options.split('|').map(o => o.trim()).filter(Boolean) : [];

  function handleSubmit() {
    if (isTrivia && !input.trim()) return;
    if (isMulti && multiInputs.some(i => !i.trim())) return;
    if (isSubjective && !selected) return;
    setAnimating(true);
    setTimeout(() => {
      if (isTrivia) onAnswer(input.trim());
      else if (isMulti) onAnswer(multiInputs);
      else onAnswer(selected);
      setAnimating(false);
    }, 200);
  }

  return (
    <div style={{
      opacity: animating ? 0 : 1,
      transform: animating ? 'translateY(8px)' : 'translateY(0)',
      transition: 'opacity 0.2s, transform 0.2s'
    }}>
      <ProgressBar current={questionNumber} total={total} />

      <div style={{ marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center' }}>
        {question.category && (
          <span style={{
            fontSize: '0.75rem',
            background: 'rgba(244,135,23,0.15)',
            color: ORANGE,
            padding: '3px 10px',
            borderRadius: 20,
            fontWeight: 500,
            letterSpacing: '0.02em'
          }}>{question.category}</span>
        )}
        {isSubjective && (
          <span style={{
            fontSize: '0.75rem',
            background: 'rgba(238,201,24,0.15)',
            color: GOLD,
            padding: '3px 10px',
            borderRadius: 20,
            fontWeight: 500
          }}>subjective</span>
        )}
        {isMulti && (
          <span style={{
            fontSize: '0.75rem',
            background: 'rgba(244,135,23,0.15)',
            color: ORANGE,
            padding: '3px 10px',
            borderRadius: 20,
            fontWeight: 500
          }}>name all {answerCount}</span>
        )}
      </div>

      <p style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '1.4rem',
        fontWeight: 400,
        lineHeight: 1.45,
        marginBottom: '1.75rem',
        color: CREAM
      }}>{question.question}</p>

      {isTrivia && (
        <input
          autoFocus
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Type your answer..."
          style={{
            width: '100%',
            padding: '0.875rem 1rem',
            fontSize: '1rem',
            border: `1.5px solid rgba(254,248,208,0.2)`,
            borderRadius: 10,
            outline: 'none',
            marginBottom: '1rem',
            background: NAVY_CARD,
            fontFamily: 'Inter, sans-serif',
            color: CREAM,
            transition: 'border-color 0.15s'
          }}
          onFocus={e => e.target.style.borderColor = ORANGE}
          onBlur={e => e.target.style.borderColor = 'rgba(254,248,208,0.2)'}
        />
      )}

      {isMulti && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1rem' }}>
          {multiInputs.map((val, i) => (
            <input
              key={i}
              autoFocus={i === 0}
              id={`multi-input-${i}`}
              type="text"
              value={val}
              onChange={e => {
                const updated = [...multiInputs];
                updated[i] = e.target.value;
                setMultiInputs(updated);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && i < multiInputs.length - 1) {
                  e.preventDefault();
                  document.getElementById(`multi-input-${i + 1}`)?.focus();
                } else if (e.key === 'Enter') {
                  handleSubmit();
                }
              }}
              placeholder={`Answer ${i + 1}...`}
              style={{
                width: '100%',
                padding: '0.875rem 1rem',
                fontSize: '1rem',
                border: `1.5px solid rgba(254,248,208,0.2)`,
                borderRadius: 10,
                outline: 'none',
                background: NAVY_CARD,
                fontFamily: 'Inter, sans-serif',
                color: CREAM,
                transition: 'border-color 0.15s'
              }}
              onFocus={e => e.target.style.borderColor = ORANGE}
              onBlur={e => e.target.style.borderColor = 'rgba(254,248,208,0.2)'}
            />
          ))}
        </div>
      )}

      {isSubjective && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1rem' }}>
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => setSelected(opt)}
              style={{
                padding: '0.875rem 1rem',
                textAlign: 'left',
                fontSize: '0.95rem',
                border: selected === opt ? `2px solid ${ORANGE}` : `1.5px solid rgba(254,248,208,0.2)`,
                borderRadius: 10,
                background: selected === opt ? 'rgba(244,135,23,0.15)' : NAVY_CARD,
                cursor: 'pointer',
                fontWeight: selected === opt ? 600 : 400,
                color: selected === opt ? ORANGE : CREAM,
                fontFamily: 'Inter, sans-serif',
                transition: 'all 0.15s'
              }}
            >{opt}</button>
          ))}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isTrivia ? !input.trim() : isMulti ? multiInputs.some(i => !i.trim()) : !selected}
        style={{
          width: '100%',
          padding: '1rem',
          background: ORANGE,
          color: CREAM,
          border: 'none',
          borderRadius: 12,
          fontSize: '1rem',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          opacity: (isTrivia ? !input.trim() : isMulti ? multiInputs.some(i => !i.trim()) : !selected) ? 0.35 : 1,
          transition: 'opacity 0.15s'
        }}
      >
        {questionNumber === 4 ? 'See results →' : 'Next question →'}
      </button>
    </div>
  );
}

function ProgressBar({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: '1.75rem' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          flex: 1,
          height: 3,
          borderRadius: 2,
          background: i < current ? ORANGE : 'rgba(254,248,208,0.15)',
          transition: 'background 0.3s'
        }} />
      ))}
    </div>
  );
}

function ResultsScreen({ questions, userAnswers, streakData, onHome }) {
  const [copied, setCopied] = useState(false);
  const triviaQuestions = questions.filter(q => q.type === 'trivia' || q.type === 'multi');
  const triviaAnswers = userAnswers.slice(0, 3);
  const score = triviaQuestions.reduce((acc, q, i) => {
    if (q.type === 'multi') return acc + (checkMultiAnswer(triviaAnswers[i] || [], q) ? 1 : 0);
    return acc + (checkAnswer(triviaAnswers[i] || '', q) ? 1 : 0);
  }, 0);
  const subjAnswer = userAnswers[3];
  const subjQuestion = questions.find(q => q.type === 'subjective');

  const emojiRow = [
    ...triviaQuestions.map((q, i) => {
      if (q.type === 'multi') return checkMultiAnswer(triviaAnswers[i] || [], q) ? '🟩' : '🟥';
      return checkAnswer(triviaAnswers[i] || '', q) ? '🟩' : '🟥';
    }),
    '⬜'
  ].join(' ');

  const shareText = `${APP_NAME}\n${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} — ${score}/3\n\n${emojiRow}\n\nPlay today's set: three-great-questions.vercel.app`;

  function copyShare() {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function nativeShare() {
    navigator.share({
      title: APP_NAME,
      text: shareText,
      url: 'https://three-great-questions.vercel.app'
    }).catch(() => {});
  }

  return (
    <div>
      <div style={{
        background: NAVY_CARD,
        border: `1px solid rgba(254,248,208,0.1)`,
        borderRadius: 14,
        padding: '1.75rem',
        marginBottom: '1rem',
        textAlign: 'center'
      }}>
        <p style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.5, marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>today's score</p>
        <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: '4rem', fontWeight: 400, color: CREAM, lineHeight: 1 }}>{score}/3</p>
        {streakData.streak > 0 && (
          <p style={{ color: ORANGE, fontSize: '0.9rem', fontWeight: 600, marginTop: 12 }}>
            🔥 {streakData.streak} day streak
          </p>
        )}
      </div>

      {triviaQuestions.map((q, i) => {
        const accepted = q.type === 'multi'
          ? checkMultiAnswer(triviaAnswers[i] || [], q)
          : checkAnswer(triviaAnswers[i] || '', q);
        return (
          <div key={i} style={{
            background: NAVY_CARD,
            border: `1px solid rgba(254,248,208,0.1)`,
            borderRadius: 14,
            padding: '1.25rem',
            marginBottom: '0.75rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: '0.75rem', color: CREAM, opacity: 0.4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Q{i + 1}</span>
              <span style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: accepted ? '#4ade80' : '#f87171',
                background: accepted ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                padding: '2px 10px',
                borderRadius: 20
              }}>
                {accepted ? '✓ correct' : '✗ incorrect'}
              </span>
            </div>
            <p style={{ fontSize: '0.95rem', fontWeight: 500, marginBottom: 10, lineHeight: 1.5, color: CREAM }}>{q.question}</p>
            <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5, marginBottom: 4 }}>
              Your answer: <span style={{ color: CREAM, opacity: 0.8 }}>
                {Array.isArray(triviaAnswers[i]) ? triviaAnswers[i].join(', ') : (triviaAnswers[i] || '—')}
              </span>
            </p>
            <p style={{ fontSize: '0.85rem', color: CREAM, opacity: 0.5 }}>
              Correct answer: <span style={{ color: CREAM, fontWeight: 600, opacity: 1 }}>
                {q.type === 'multi' ? q.answer.split('|').join(', ') : q.answer}
              </span>
            </p>
            {q.explanation && (
              <p style={{
                fontSize: '0.85rem',
                color: GOLD,
                lineHeight: 1.6,
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid rgba(254,248,208,0.1)`,
                fontStyle: 'italic'
              }}>{q.explanation}</p>
            )}
          </div>
        );
      })}

      {subjQuestion && (
        <div style={{
          background: 'rgba(244,135,23,0.1)',
          border: `1px solid rgba(244,135,23,0.3)`,
          borderRadius: 14,
          padding: '1.25rem',
          marginBottom: '1rem'
        }}>
          <p style={{ fontSize: '0.75rem', color: ORANGE, marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>subjective question</p>
          <p style={{ fontSize: '0.95rem', fontWeight: 500, marginBottom: 8, lineHeight: 1.5, color: CREAM }}>
            {subjQuestion.question}
          </p>
          <p style={{ fontSize: '0.875rem', color: CREAM, opacity: 0.7 }}>
            You chose: <span style={{ fontWeight: 600, color: ORANGE }}>{subjAnswer}</span>
          </p>
        </div>
      )}

      <div style={{
        background: NAVY_CARD,
        border: `1px solid rgba(254,248,208,0.1)`,
        borderRadius: 14,
        padding: '1.25rem',
        marginBottom: '0.75rem',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
        lineHeight: 1.8,
        whiteSpace: 'pre-wrap',
        color: CREAM,
        opacity: 0.8
      }}>{shareText}</div>

      <div style={{ display: 'flex', gap: 10, marginBottom: '0.75rem' }}>
        {navigator.share && (
          <button type="button" onClick={nativeShare} style={{
            flex: 1,
            padding: '1rem',
            background: ORANGE,
            color: CREAM,
            border: 'none',
            borderRadius: 12,
            fontSize: '1rem',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif'
          }}>
            Share ↗
          </button>
        )}
        <button type="button" onClick={copyShare} style={{
          flex: 1,
          padding: '1rem',
          background: copied ? '#4ade80' : 'transparent',
          color: copied ? NAVY : CREAM,
          border: copied ? '1.5px solid #4ade80' : `1.5px solid rgba(254,248,208,0.25)`,
          borderRadius: 12,
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          transition: 'all 0.2s'
        }}>
          {copied ? '✓ Copied!' : 'Copy results'}
        </button>
      </div>

      <button type="button" onClick={onHome} style={{
        width: '100%',
        padding: '1rem',
        background: ORANGE,
        color: CREAM,
        border: 'none',
        borderRadius: 12,
        fontSize: '1rem',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'Inter, sans-serif'
      }}>
        ← Back to home
      </button>
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div style={{
      flex: 1,
      background: NAVY_CARD,
      border: `1px solid rgba(254,248,208,0.1)`,
      borderRadius: 10,
      padding: '0.75rem 1rem',
      textAlign: 'center'
    }}>
      <p style={{ fontSize: '0.7rem', color: CREAM, opacity: 0.4, marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: CREAM }}>{value}</p>
    </div>
  );
}
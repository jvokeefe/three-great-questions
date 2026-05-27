import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const APP_NAME = "Three Great Questions";
const APP_SUBTITLE = "(and one subjective one)";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTM0iHRnP1bO58W-iwacGqB7OLZ3uyX4qK4J11lYA3J6P-VFOobsxwWg2sbEJ59EN-_-3Vpkwo63n-L/pub?output=csv";

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

async function getTodaySet(allQuestions) {
  const today = getTodayKey();
  const trivia = allQuestions.filter(q => q.type === 'trivia');
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
  const triviaQs = questions.filter(q => q.type === 'trivia');
  const result = await supabase.from('user_responses').upsert({
    session_id: sessionId,
    set_date: today,
    q1_answer: userAnswers[0],
    q1_accepted: checkAnswer(userAnswers[0] || '', triviaQs[0]),
    q2_answer: userAnswers[1],
    q2_accepted: checkAnswer(userAnswers[1] || '', triviaQs[1]),
    q3_answer: userAnswers[2],
    q3_accepted: checkAnswer(userAnswers[2] || '', triviaQs[2]),
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
      if (levenshtein(userAnswer, target) <= Math.max(1, Math.floor(target.length * 0.2))) return true;
    }
  }
  return false;
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
  const sessionId = getSessionId();
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    async function init() {
      try {
        const [allQuestions, streak, response, allResponses] = await Promise.all([
          fetchQuestions(SHEET_URL),
          getStreak(sessionId),
          getTodayResponse(sessionId),
          getAllResponses(sessionId)
        ]);

        const todaySet = await getTodaySet(allQuestions);
        setQuestions(todaySet);
        setStreakData(streak);

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
      const triviaQs = questions.filter(q => q.type === 'trivia');
      const score = triviaQs.reduce((acc, q, i) => acc + (checkAnswer(newAnswers[i] || '', q) ? 1 : 0), 0);
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
      textAlign: 'center'
    }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>{APP_NAME}</h1>
      <p style={{ color: '#888', fontSize: '0.95rem' }}>{APP_SUBTITLE}</p>
      <p style={{ color: '#aaa', fontSize: '0.9rem', marginTop: '2rem' }}>
        Get ready for the best part of the day!
      </p>
    </div>
  );

  if (error) return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{APP_NAME}</h1>
      <p style={{ color: '#cc4444', marginTop: '2rem' }}>{error}</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3 }}>{APP_NAME}</h1>
        <p style={{ color: '#888', fontSize: '0.95rem', marginTop: 4 }}>{APP_SUBTITLE}</p>
      </div>

      {screen === 'home' && (
        <HomeScreen
          today={today}
          onStart={handleStart}
          streakData={streakData}
          alreadyPlayed={alreadyPlayed}
          todayResponse={todayResponse}
          correctPct={correctPct}
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

function HomeScreen({ today, onStart, streakData, alreadyPlayed, todayResponse, correctPct }) {
  return (
    <div>
      <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1.5rem', textAlign: 'center' }}>{today}</p>

      <div style={{
        background: '#fff',
        border: '1px solid #e8e8e4',
        borderRadius: 12,
        padding: '1.5rem',
        marginBottom: '1.5rem',
        textAlign: 'center'
      }}>
        {alreadyPlayed ? (
          <>
            <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6 }}>You've played today!</p>
            <p style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: 4 }}>{todayResponse.score}/3</p>
            <p style={{ fontSize: '0.9rem', color: '#666' }}>Come back tomorrow for a new set.</p>
          </>
        ) : (
          <>
            <p style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 6 }}>Today's set is ready.</p>
            <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: 1.6 }}>
              3 trivia questions + 1 subjective prompt.
            </p>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: '1.5rem' }}>
        <StatPill label="Current streak" value={`${streakData.streak || 0} days`} />
        <StatPill label="Longest streak" value={`${streakData.best_streak || 0} days`} />
        {correctPct !== null && (
          <StatPill label="Correct %" value={`${correctPct}%`} />
        )}
      </div>

      {!alreadyPlayed && (
        <button onClick={onStart} style={{
          width: '100%',
          padding: '0.875rem',
          background: '#1a1a1a',
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer'
        }}>
          Start today's questions →
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
  const options = question.options ? question.options.split('|').map(o => o.trim()).filter(Boolean) : [];

  function handleSubmit() {
    if (isTrivia && !input.trim()) return;
    if (isSubjective && !selected) return;
    setAnimating(true);
    setTimeout(() => {
      onAnswer(isTrivia ? input.trim() : selected);
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

      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: 8, alignItems: 'center' }}>
        {question.category && (
          <span style={{
            fontSize: '0.75rem',
            background: '#f0f0ec',
            color: '#666',
            padding: '2px 10px',
            borderRadius: 20
          }}>{question.category}</span>
        )}
        {isSubjective && (
          <span style={{
            fontSize: '0.75rem',
            background: '#f0eeff',
            color: '#6655cc',
            padding: '2px 10px',
            borderRadius: 20
          }}>subjective</span>
        )}
      </div>

      <p style={{
        fontSize: '1.2rem',
        fontWeight: 600,
        lineHeight: 1.5,
        marginBottom: '1.5rem'
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
            border: '1.5px solid #ddd',
            borderRadius: 10,
            outline: 'none',
            marginBottom: '1rem',
            background: '#fff'
          }}
        />
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
                border: selected === opt ? '2px solid #1a1a1a' : '1.5px solid #ddd',
                borderRadius: 10,
                background: selected === opt ? '#f5f5f2' : '#fff',
                cursor: 'pointer',
                fontWeight: selected === opt ? 600 : 400,
                transition: 'all 0.15s'
              }}
            >{opt}</button>
          ))}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isTrivia ? !input.trim() : !selected}
        style={{
          width: '100%',
          padding: '0.875rem',
          background: '#1a1a1a',
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          opacity: (isTrivia ? !input.trim() : !selected) ? 0.35 : 1,
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
    <div style={{ display: 'flex', gap: 6, marginBottom: '1.5rem' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: i < current ? '#1a1a1a' : '#e0e0da',
          transition: 'background 0.3s'
        }} />
      ))}
    </div>
  );
}

function ResultsScreen({ questions, userAnswers, streakData, onHome }) {
  const [copied, setCopied] = useState(false);
  const triviaQuestions = questions.filter(q => q.type === 'trivia');
  const triviaAnswers = userAnswers.slice(0, 3);
  const score = triviaQuestions.reduce((acc, q, i) => acc + (checkAnswer(triviaAnswers[i] || '', q) ? 1 : 0), 0);
  const subjAnswer = userAnswers[3];
  const subjQuestion = questions.find(q => q.type === 'subjective');

  const emojiRow = [
    ...triviaQuestions.map((q, i) => checkAnswer(triviaAnswers[i] || '', q) ? '🟩' : '🟥'),
    '🎭'
  ].join(' ');

  const shareText = `${APP_NAME}\n${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} — ${score}/3\n\n${emojiRow}\n\nthree-great-questions.vercel.app`;

  function copyShare() {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div>
      <div style={{
        background: '#fff',
        border: '1px solid #e8e8e4',
        borderRadius: 12,
        padding: '1.5rem',
        marginBottom: '1rem',
        textAlign: 'center'
      }}>
        <p style={{ fontSize: '3rem', fontWeight: 700 }}>{score}/3</p>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>today's score</p>
        {streakData.streak > 0 && (
          <p style={{ color: '#2a9d6a', fontSize: '0.9rem', fontWeight: 600, marginTop: 8 }}>
            🔥 {streakData.streak} day streak
          </p>
        )}
      </div>

      {triviaQuestions.map((q, i) => {
        const accepted = checkAnswer(triviaAnswers[i] || '', q);
        return (
          <div key={i} style={{
            background: '#fff',
            border: '1px solid #e8e8e4',
            borderRadius: 12,
            padding: '1.25rem',
            marginBottom: '0.75rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '0.8rem', color: '#888' }}>Q{i + 1}</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: accepted ? '#2a9d6a' : '#cc4444' }}>
                {accepted ? '✓ correct' : '✗ incorrect'}
              </span>
            </div>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>{q.question}</p>
            <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: 4 }}>
              Your answer: <span style={{ color: '#1a1a1a' }}>{triviaAnswers[i] || '—'}</span>
            </p>
            <p style={{ fontSize: '0.85rem', color: '#888' }}>
              Correct answer: <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{q.answer}</span>
            </p>
            {q.explanation && (
              <p style={{
                fontSize: '0.85rem',
                color: '#555',
                lineHeight: 1.6,
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid #f0f0ec'
              }}>{q.explanation}</p>
            )}
          </div>
        );
      })}

      {subjQuestion && (
        <div style={{
          background: '#f8f6ff',
          border: '1px solid #e8e4ff',
          borderRadius: 12,
          padding: '1.25rem',
          marginBottom: '1rem'
        }}>
          <p style={{ fontSize: '0.8rem', color: '#6655cc', marginBottom: 6 }}>subjective question</p>
          <p style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>
            {subjQuestion.question}
          </p>
          <p style={{ fontSize: '0.85rem', color: '#555' }}>
            You chose: <span style={{ fontWeight: 600 }}>{subjAnswer}</span>
          </p>
        </div>
      )}

      <div style={{
        background: '#f5f5f2',
        borderRadius: 12,
        padding: '1.25rem',
        marginBottom: '0.75rem',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
        lineHeight: 1.8,
        whiteSpace: 'pre-wrap'
      }}>{shareText}</div>

      <button type="button" onClick={copyShare} style={{
        width: '100%',
        padding: '0.875rem',
        background: copied ? '#2a9d6a' : '#fff',
        color: copied ? '#fff' : '#1a1a1a',
        border: copied ? '1.5px solid #2a9d6a' : '1.5px solid #ddd',
        borderRadius: 10,
        fontSize: '1rem',
        fontWeight: 600,
        cursor: 'pointer',
        marginBottom: '0.75rem',
        transition: 'background 0.2s, color 0.2s, border 0.2s'
      }}>
        {copied ? '✓ Copied!' : 'Copy results'}
      </button>

      <button type="button" onClick={onHome} style={{
        width: '100%',
        padding: '0.875rem',
        background: '#1a1a1a',
        color: '#fff',
        border: 'none',
        borderRadius: 10,
        fontSize: '1rem',
        fontWeight: 600,
        cursor: 'pointer'
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
      background: '#f5f5f2',
      borderRadius: 10,
      padding: '0.75rem 1rem',
      textAlign: 'center'
    }}>
      <p style={{ fontSize: '0.7rem', color: '#888', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>{value}</p>
    </div>
  );
}
import { useState } from 'react';

const APP_NAME = "Three Great Questions";
const APP_SUBTITLE = "(and one subjective one)";

const SAMPLE_QUESTIONS = [
  {
    id: 1,
    type: 'trivia',
    question: 'What is the only planet in our solar system that rotates on its side?',
    answer: 'Uranus',
    category: 'Science',
    difficulty: 2,
    fun: 4,
    explanation: 'Uranus has an axial tilt of 98 degrees, meaning it essentially rolls around the sun on its side. Scientists believe a massive collision billions of years ago knocked it over.'
  },
  {
    id: 2,
    type: 'trivia',
    question: 'In what year did the Berlin Wall fall?',
    answer: '1989',
    category: 'History',
    difficulty: 2,
    fun: 3,
    explanation: 'The Berlin Wall fell on November 9, 1989, after 28 years of dividing the city. A miscommunicated announcement led to crowds overwhelming the checkpoints that same evening.'
  },
  {
    id: 3,
    type: 'trivia',
    question: 'Who wrote the novel Frankenstein?',
    answer: 'Mary Shelley',
    category: 'Literature',
    difficulty: 2,
    fun: 4,
    explanation: 'Mary Shelley wrote Frankenstein in 1818 at just 18 years old, during a rainy summer in Geneva on a dare from Lord Byron to write a ghost story.'
  },
  {
    id: 4,
    type: 'subjective',
    question: "What's your ideal Sunday morning?",
    category: 'Lifestyle',
    options: ['Sleeping in late', 'Coffee and a long read', 'Brunch with friends', 'Getting outside early']
  }
];

function normalize(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

function checkAnswer(input, question) {
  const userAnswer = normalize(input);
  if (!userAnswer) return false;

  const targets = [question.answer, ...(question.aliases ? question.aliases.split(',') : [])].map(normalize);

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
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  function handleStart() {
    setCurrentQ(0);
    setUserAnswers([]);
    setScreen('questions');
  }

  function handleAnswer(answer) {
    const newAnswers = [...userAnswers, answer];
    setUserAnswers(newAnswers);
    if (currentQ < SAMPLE_QUESTIONS.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      setScreen('results');
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3 }}>{APP_NAME}</h1>
        <p style={{ color: '#888', fontSize: '0.95rem', marginTop: 2 }}>{APP_SUBTITLE}</p>
      </div>

      {screen === 'home' && (
        <HomeScreen today={today} onStart={handleStart} />
      )}
      {screen === 'questions' && (
        <QuestionScreen
        key={currentQ}
        question={SAMPLE_QUESTIONS[currentQ]}
        questionNumber={currentQ + 1}
        total={SAMPLE_QUESTIONS.length}
        onAnswer={handleAnswer}
      />
      )}
      {screen === 'results' && (
        <ResultsScreen
          questions={SAMPLE_QUESTIONS}
          userAnswers={userAnswers}
          onHome={() => setScreen('home')}
        />
      )}
    </div>
  );
}

function HomeScreen({ today, onStart }) {
  return (
    <div>
      <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1.5rem' }}>{today}</p>
      <div style={{
        background: '#fff',
        border: '1px solid #e8e8e4',
        borderRadius: 12,
        padding: '1.5rem',
        marginBottom: '1.5rem'
      }}>
        <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6 }}>Today's set is ready.</p>
        <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: 1.6 }}>
          3 trivia questions + 1 subjective prompt.<br />
          Takes about 2–3 minutes.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem' }}>
        <StatPill label="Streak" value="0 days" />
        <StatPill label="Best" value="0 days" />
      </div>
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
    </div>
  );
}

function QuestionScreen({ question, questionNumber, total, onAnswer }) {
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState(null);
  const isSubjective = question.type === 'subjective';
  const isTrivia = question.type === 'trivia';

  function handleSubmit() {
    if (isTrivia && !input.trim()) return;
    if (isSubjective && !selected) return;
    onAnswer(isTrivia ? input.trim() : selected);
  }

  return (
    <div>
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
        <div>
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
        </div>
      )}

      {isSubjective && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1rem' }}>
          {question.options.map(opt => (
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
                fontWeight: selected === opt ? 600 : 400
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
          opacity: (isTrivia ? !input.trim() : !selected) ? 0.35 : 1
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
          background: i < current ? '#1a1a1a' : '#e0e0da'
        }} />
      ))}
    </div>
  );
}

function ResultsScreen({ questions, userAnswers, onHome }) {
  const [copied, setCopied] = useState(false);
  const triviaQuestions = questions.filter(q => q.type === 'trivia');
  const triviaAnswers = userAnswers.slice(0, 3);
  const score = triviaQuestions.reduce((acc, q, i) => acc + (checkAnswer(triviaAnswers[i] || '', q) ? 1 : 0), 0);
  const subjAnswer = userAnswers[3];
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
      </div>

      {triviaQuestions.map((q, i) => {
        const accepted = checkAnswer(triviaAnswers[i] || '', q);
        return (
          <div key={q.id} style={{
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
            <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: accepted ? 0 : 8 }}>
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

<div style={{
        background: '#f8f6ff',
        border: '1px solid #e8e4ff',
        borderRadius: 12,
        padding: '1.25rem',
        marginBottom: '1rem'
      }}>
        <p style={{ fontSize: '0.8rem', color: '#6655cc', marginBottom: 6 }}>subjective question</p>
        <p style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>
          {questions[3].question}
        </p>
        <p style={{ fontSize: '0.85rem', color: '#555' }}>
          You chose: <span style={{ fontWeight: 600 }}>{subjAnswer}</span>
        </p>
      </div>

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
      padding: '0.75rem 1rem'
    }}>
      <p style={{ fontSize: '0.75rem', color: '#888', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: '1rem', fontWeight: 600 }}>{value}</p>
    </div>
  );
}
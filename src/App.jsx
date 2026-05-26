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
    question: 'What\'s your ideal Sunday morning?',
    category: 'Lifestyle',
    options: ['Sleeping in late', 'Coffee and a long read', 'Brunch with friends', 'Getting outside early']
  }
];

export default function App() {
  const [screen, setScreen] = useState('home');
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3 }}>{APP_NAME}</h1>
        <p style={{ color: '#888', fontSize: '0.95rem', marginTop: 2 }}>{APP_SUBTITLE}</p>
      </div>

      {screen === 'home' && (
        <HomeScreen today={today} onStart={() => setScreen('questions')} />
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

      <button
        onClick={onStart}
        style={{
          width: '100%',
          padding: '0.875rem',
          background: '#1a1a1a',
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        Start today's questions →
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
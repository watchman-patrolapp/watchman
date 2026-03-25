import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaBookOpen, FaPrint } from 'react-icons/fa';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUIDE_SECTIONS = [
  {
    id: 'vehicle',
    title: 'Add Your Vehicle',
    content: `Go to **Profile → Vehicles** to add your vehicle(s). You can set a primary vehicle and choose its colour. If you have multiple cars, you'll be able to select which one you're using when starting a patrol.`,
  },
  {
    id: 'schedule',
    title: 'Join a Patrol',
    content: `Navigate to **Patrol Schedule** and sign up for an available time slot. You can sign up for multiple dates.`,
  },
  {
    id: 'start',
    title: 'Start a Patrol',
    content: `On your dashboard, click **Start Patrol**. Your timer will begin, and other patrollers will see that you're active. When you're done, click **End Patrol** – the log will be saved automatically.`,
  },
  {
    id: 'auto-end',
    title: 'Patrol Auto‑End Safeguard',
    content: `If you forget to end your patrol, the system will warn you after 2 hours. If you don't respond, your patrol will automatically end after 2.5 hours, and the log will be marked as **auto‑closed**. This ensures accurate records and prevents abandoned patrols.`,
  },
  {
    id: 'incidents',
    title: 'Report Incidents',
    content: `Use the **Report Incident** button to submit observations. You can attach up to 10 photos. Incidents are moderated by admins before they become visible to everyone.`,
  },
  {
    id: 'chat',
    title: 'Emergency Chat',
    content: `The **Emergency Chat** allows real‑time coordination with other patrollers. Messages automatically disappear after 24 hours, but are permanently stored for admins.`,
  },
  {
    id: 'admin',
    title: 'Admin Features',
    content: `If you're an admin, you'll have access to the **Admin Panel** where you can manage users, moderate incidents, view patrol logs, and export data.`,
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({ title, children, action }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-8">
      <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function GuideSection({ number, title, children }) {
  return (
    <div className="flex gap-4 pb-6 mb-6 border-b border-gray-100 dark:border-gray-700 last:border-0 last:pb-0 last:mb-0">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">
        {number}
      </div>
      <div className="flex-1">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
        <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
}

function AlertBox({ title, children, variant = 'warning' }) {
  const variants = {
    warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200',
    info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-200',
  };
  
  return (
    <div className={`border-l-4 p-4 rounded-r-xl ${variants[variant]}`}>
      <p className="text-sm">
        {title && <strong className="block mb-1">{title}</strong>}
        {children}
      </p>
    </div>
  );
}

function RichText({ content }) {
  const parts = content.split(/(\*\*.*?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Guide() {
  const navigate = useNavigate();
  const [printing, setPrinting] = useState(false);

  const handlePrint = () => {
    setPrinting(true);
    window.print();
    setPrinting(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <button
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            <FaArrowLeft className="w-3 h-3" />
            Dashboard
          </button>
          
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FaBookOpen className="w-6 h-6 text-indigo-500" />
            Quick Start Guide
          </h1>
          
          <button
            onClick={handlePrint}
            disabled={printing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl transition text-sm font-medium shadow-sm"
          >
            <FaPrint className="w-4 h-4" />
            {printing ? 'Printing...' : 'Print'}
          </button>
        </div>

        {/* Guide Content */}
        <SectionCard title="Getting Started">
          <div className="space-y-0">
            {GUIDE_SECTIONS.map((section, index) => (
              <GuideSection 
                key={section.id} 
                number={index + 1} 
                title={section.title}
              >
                <RichText content={section.content} />
              </GuideSection>
            ))}
          </div>
        </SectionCard>

        {/* Reminder */}
        <AlertBox title="Remember:" variant="warning">
          This platform is a tool to enhance neighbourhood safety. Always act within the law and follow the SOP. If you're unsure, contact an admin.
        </AlertBox>

      </div>
    </div>
  );
}
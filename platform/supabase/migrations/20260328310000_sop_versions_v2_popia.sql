-- SOP content v2.0: expanded procedures, POPIA-aligned personal information handling,
-- and clear patroller can / cannot boundaries. Deactivates prior rows then activates 2.0.

CREATE TABLE IF NOT EXISTS public.sop_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT false,
  cards jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sop_versions_active_idx ON public.sop_versions (active) WHERE (active = true);

ALTER TABLE public.sop_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sop_versions_select_authenticated" ON public.sop_versions;
CREATE POLICY "sop_versions_select_authenticated"
  ON public.sop_versions
  FOR SELECT
  TO authenticated
  USING (true);

UPDATE public.sop_versions SET active = false WHERE active = true;

INSERT INTO public.sop_versions (version, active, cards)
VALUES (
  '2.0',
  true,
  $SOP$[
  {
    "title": "Your role as a patroller",
    "scenario": "Neighbourhood watch supports the South African Police Service (SAPS) and your community. Patrollers add visible presence and accurate information—they do not replace SAPS or private security unless your structure formally contracts that.",
    "do": [
      "Follow your watch committee instructions and this platform SOP.",
      "Observe, note details, and report through approved channels (app, radio, SAPS as appropriate).",
      "Stay visible, calm, and professional; de-escalate where safe to do so.",
      "Use the app only for legitimate watch coordination and incident recording."
    ],
    "doNot": [
      "Act as if you have police powers (search, arrest, seizure) unless the law and your watch constitution explicitly allow a specific act.",
      "Confront, threaten, or physically engage except in lawful self-defence or defence of others as allowed by law—when in doubt, observe and call SAPS.",
      "Share operational details publicly (social media) in ways that compromise safety or investigations."
    ]
  },
  {
    "title": "Personal information & POPIA",
    "scenario": "South Africa’s Protection of Personal Information Act (POPIA) applies when the platform and members process names, phone numbers, addresses, photos, patrol locations, incident narratives, and intelligence fields. Processing must be lawful, limited, and secure.",
    "do": [
      "Collect and upload only information needed for neighbourhood safety, coordination, or a documented incident.",
      "Keep member and third-party details accurate; correct mistakes via admins when you notice them.",
      "Use information only for the watch’s stated purposes—not for personal curiosity, side businesses, or unrelated messaging.",
      "Protect your login, device, and screenshots; report suspected breaches or misuse to an admin immediately.",
      "When taking photos for incidents, prefer scenes and vehicles; avoid unnecessary close-ups of bystanders’ faces unless relevant and proportionate."
    ],
    "doNot": [
      "Copy member or suspect data into private WhatsApp groups, personal cloud, or email without watch approval and a clear need.",
      "Harvest addresses, IDs, or images for any purpose outside the watch’s legitimate activities.",
      "Share intelligence or incident packs with people who are not authorised on the platform or by your committee."
    ]
  },
  {
    "title": "Addresses, profiles & contact details",
    "scenario": "Residential addresses, phone numbers, and linked vehicles help coordination but are sensitive. Treat them as personal information under POPIA.",
    "do": [
      "Enter your own profile and vehicle details truthfully so dispatch and admins can reach you when needed.",
      "Limit what you record about others to what is necessary for a real safety or incident purpose.",
      "Use official app fields (incidents, intelligence) so access is controlled by roles and policies."
    ],
    "doNot": [
      "Publish another person’s home address or contact details in chat or free-text fields except where essential to an active, authorised incident report.",
      "Build or maintain shadow lists outside the platform that duplicate sensitive watch data."
    ]
  },
  {
    "title": "Photographs & video",
    "scenario": "Images can be powerful evidence but intrude on privacy. Balance proportionality with safety and investigation needs.",
    "do": [
      "Capture evidence that supports a factual incident description (scene, damage, registration plates, clothing from a safe distance).",
      "Upload through the app or workflows your admins specify so retention and access are governed.",
      "If asked to stop filming in a purely private space where you have no right to be, comply and escalate via SAPS if needed."
    ],
    "doNot": [
      "Take intimate, humiliating, or sexualised images; do not distribute child-related imagery except through SAPS—never share such media in chat.",
      "Edit or mislabel photos to imply guilt; do not crop out context in a misleading way.",
      "Live-stream confrontations in ways that endanger people or prejudice a fair process."
    ]
  },
  {
    "title": "What patrollers may do",
    "scenario": "These are typical powers of observation and reporting—your local constitution, insurance, and SAPS agreements may add detail.",
    "do": [
      "Patrol in pairs or teams where required; sign in/out per your schedule.",
      "Report suspicious activity, hazards, and crimes to SAPS on 10111 / 08600 10111 or your agreed emergency line when life or property is at risk.",
      "Complete incident forms with clear facts: time, place, what was seen, identifiers (vehicle, clothing), and witnesses if safe to note.",
      "Use emergency chat and templates for coordinated, time-stamped communication.",
      "Escalate to admins when unsure about intelligence entries, moderation, or media uploads."
    ],
    "doNot": []
  },
  {
    "title": "What patrollers must not do",
    "scenario": "These limits reduce legal and safety risk to you and the community.",
    "do": [],
    "doNot": [
      "Stop and search people or vehicles without lawful authority.",
      "Detain, handcuff, or transport anyone except where the law clearly permits a private person’s arrest—and then only with minimal force and immediate SAPS handover.",
      "Enter private property without consent, climb walls, or bypass locks.",
      "Discriminate on race, gender, religion, nationality, disability, or other protected grounds when observing or reporting.",
      "Use the platform to harass, stalk, defame, or bully members or the public.",
      "Carry prohibited weapons or use force beyond reasonable self-defence."
    ]
  },
  {
    "title": "Incidents, chat & records",
    "scenario": "The app creates an audit trail. Messages and incident records may be disclosed to SAPS, insurers, or regulators if lawfully required.",
    "do": [
      "Write factually: what you saw, heard, or were told by identifiable witnesses—distinguish fact from hearsay.",
      "Use templates and channels your admins designate for urgent versus routine traffic.",
      "Respect moderation outcomes; appeal through admins rather than reposting removed content."
    ],
    "doNot": [
      "Post names or photos of suspects as “guilty” before SAPS or courts establish facts—use neutral language and intelligence workflows.",
      "Delete or tamper with records unless an admin corrects an error through proper channels.",
      "Spam, advertise, or run unrelated campaigns through watch channels."
    ]
  },
  {
    "title": "Acceptance",
    "scenario": "By continuing you confirm you have read this SOP and understand how personal information is handled in line with POPIA principles (lawfulness, minimality, security, and purpose limitation) for neighbourhood watch activities on this platform.",
    "do": [
      "Ask your committee or an admin if any instruction here conflicts with local agreements—follow the stricter rule.",
      "Re-read updated SOP versions when prompted after a version change."
    ],
    "doNot": [
      "Tick acceptance without reading; misrepresenting acceptance may breach watch rules and POPIA accountability expectations."
    ]
  }
]
$SOP$::jsonb
)
ON CONFLICT (version) DO UPDATE SET
  active = EXCLUDED.active,
  cards = EXCLUDED.cards;

UPDATE public.sop_versions SET active = (version = '2.0');

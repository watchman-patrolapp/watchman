import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { supabase } from '../supabase/client';
import { downloadDomAsPdf } from '../utils/downloadDomAsPdf';
import {
  normalizeMediaUrls,
  EVIDENCE_CATEGORY_LABELS,
} from '../components/evidence/StructuredEvidenceList';
import {
  INCIDENT_SECTION_LABELS,
  INCIDENT_SECTION_PRINT_ORDER,
  groupIncidentSectionUpdatesByKey,
  formatSectionRoleLabel,
} from '../constants/incidentSectionUpdates';
import { connectionTypeLabel } from '../data/profileIncidentLinkTaxonomy';
import BrandedLoader from '../components/layout/BrandedLoader';

/** Renders public image URLs for screen + print/PDF (browser must be able to fetch the URL). */
function EvidenceImageGrid({ urls, altPrefix }) {
  if (!urls?.length) return null;
  return (
    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
      {urls.map((url, idx) => (
        <figure
          key={`${url}-${idx}`}
          className="mx-auto max-w-full print:break-inside-avoid"
        >
          <img
            src={url}
            alt={`${altPrefix} photo ${idx + 1}`}
            loading="eager"
            decoding="async"
            className="mx-auto max-h-72 w-full rounded-md border border-gray-200 bg-gray-50 object-contain dark:border-gray-600 print:max-h-[14cm] print:border-gray-400"
          />
        </figure>
      ))}
    </div>
  );
}

export default function PrintIncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [incident, setIncident] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [linkedProfiles, setLinkedProfiles] = useState([]);
  const [sectionUpdates, setSectionUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const articleRef = useRef(null);
  const pdfAutoDownloadTriggered = useRef(false);

  useEffect(() => {
    pdfAutoDownloadTriggered.current = false;
  }, [id]);

  const handleDownloadPdf = useCallback(async () => {
    const el = articleRef.current;
    if (!el) {
      toast.error('Report content is not ready yet.');
      return;
    }
    setPdfBusy(true);
    toast.loading('Building PDF…', { id: 'pdf-export' });
    try {
      const filename = `incident-${id.slice(0, 8)}-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
      await downloadDomAsPdf(el, filename, { waitForImages: true });
      toast.success('PDF saved', { id: 'pdf-export' });
    } catch (e) {
      console.error('PDF export:', e);
      toast.error('Could not build PDF. Use Print → Save as PDF instead.', { id: 'pdf-export' });
    } finally {
      setPdfBusy(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data: inc, error: incErr } = await supabase
          .from('incidents')
          .select('*')
          .eq('id', id)
          .single();
        if (incErr) throw incErr;

        const { data: ev, error: evErr } = await supabase
          .from('incident_evidence')
          .select('*')
          .eq('incident_id', id);
        if (evErr) throw evErr;

        const { data: links, error: linkErr } = await supabase
          .from('profile_incidents')
          .select('*, profile:profile_id (id, primary_name, risk_level)')
          .eq('incident_id', id);
        if (linkErr) throw linkErr;

        const { data: su, error: suErr } = await supabase
          .from('incident_section_updates')
          .select('*')
          .eq('incident_id', id)
          .order('created_at', { ascending: true });
        if (suErr) throw suErr;

        if (!cancelled) {
          setIncident(inc);
          setEvidence(ev || []);
          setLinkedProfiles(links || []);
          setSectionUpdates(su || []);
        }
      } catch (e) {
        console.error('Print incident load:', e);
        if (!cancelled) setIncident(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pdfIntent = searchParams.get('intent');
  useEffect(() => {
    if (loading || !incident) return;
    if (pdfIntent !== 'pdf') return;
    if (pdfAutoDownloadTriggered.current) return;
    pdfAutoDownloadTriggered.current = true;
    const timer = window.setTimeout(() => {
      void handleDownloadPdf().finally(() => {
        const next = new URLSearchParams(window.location.search);
        next.delete('intent');
        setSearchParams(next, { replace: true });
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [loading, incident, pdfIntent, handleDownloadPdf, setSearchParams]);

  const openPrintDialog = () => window.print();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading incident for print…" size="lg" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-6 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">Incident not found.</p>
        <button
          type="button"
          onClick={() => navigate('/incidents')}
          className="rounded-xl bg-gray-200 px-4 py-2 text-sm dark:bg-gray-700 dark:text-white"
        >
          Back to incidents
        </button>
      </div>
    );
  }

  const legacyPhotos = normalizeMediaUrls(incident.media_urls);
  const updatesBySection = groupIncidentSectionUpdatesByKey(sectionUpdates);
  const sectionOrder = INCIDENT_SECTION_PRINT_ORDER;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 print:bg-white print:p-4 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-4xl px-4 print:max-w-none print:px-0">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <button
            type="button"
            onClick={() => navigate(`/incidents/${id}`)}
            className="rounded-xl bg-gray-200 px-4 py-2 text-sm text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            ← Back to incident
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openPrintDialog}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Print
            </button>
            <button
              type="button"
              disabled={pdfBusy}
              onClick={() => void handleDownloadPdf()}
              className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pdfBusy ? 'Saving PDF…' : 'Save as PDF'}
            </button>
          </div>
        </div>
        <p className="mb-4 hidden text-center text-xs text-gray-500 print:block">
          Use your system print dialog to choose a printer or &quot;Save as PDF&quot;.
        </p>

        <article
          ref={articleRef}
          id="incident-pdf-root"
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none dark:border-gray-700 dark:bg-gray-800"
        >
          <header className="border-b border-gray-200 pb-4 dark:border-gray-600 print:border-black">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white print:text-black">
              Incident report
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 print:text-gray-800">
              Reference: {id} · Status: {incident.status} · Generated {format(new Date(), 'PPpp')}
            </p>
          </header>

          <section className="mt-6 space-y-4 text-sm print:break-inside-avoid">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white print:text-black">Details</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Date of incident</dt>
                <dd className="text-gray-900 dark:text-white print:text-black">
                  {format(new Date(incident.incident_date), 'PPP')}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Location</dt>
                <dd className="text-gray-900 dark:text-white print:text-black">{incident.location}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Type</dt>
                <dd className="text-gray-900 dark:text-white print:text-black">{incident.type}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Reported by</dt>
                <dd className="text-gray-900 dark:text-white print:text-black">
                  {incident.submitted_by_name} · {format(new Date(incident.submitted_at), 'PPp')}
                </dd>
              </div>
            </dl>
            <div>
              <dt className="text-xs font-medium uppercase text-gray-500">Description</dt>
              <dd className="mt-1 whitespace-pre-wrap text-gray-900 dark:text-white print:text-black">
                {incident.description}
              </dd>
            </div>
            {(incident.suspect_name || incident.suspect_description) && (
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Suspect</dt>
                <dd className="mt-1 whitespace-pre-wrap text-gray-900 dark:text-white print:text-black">
                  {incident.suspect_name && <span className="block">Name: {incident.suspect_name}</span>}
                  {incident.suspect_description}
                </dd>
              </div>
            )}
            {incident.vehicle_info && (
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Vehicle</dt>
                <dd className="mt-1 text-gray-900 dark:text-white print:text-black">{incident.vehicle_info}</dd>
              </div>
            )}
            {incident.saps_case_number && (
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">SAPS case</dt>
                <dd className="mt-1 text-gray-900 dark:text-white print:text-black">{incident.saps_case_number}</dd>
              </div>
            )}
            {incident.witness_present && (
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Witness</dt>
                <dd className="mt-1 text-gray-900 dark:text-white print:text-black">
                  {incident.witness_name?.trim() || 'Yes (name not provided)'}
                </dd>
              </div>
            )}
          </section>

          {sectionUpdates.length > 0 && (
            <section className="mt-8 print:break-inside-avoid">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white print:text-black">
                Official section updates
              </h2>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 print:text-gray-800">
                The original submission above is unchanged. The following notes were added by authorised members (append-only).
              </p>
              <ul className="mt-4 list-none space-y-4">
                {sectionOrder.map((key) => {
                  const rows = updatesBySection[key];
                  if (!rows?.length) return null;
                  const label = INCIDENT_SECTION_LABELS[key] || key;
                  return (
                    <li
                      key={key}
                      className="rounded-lg border border-amber-200 bg-amber-50/90 p-3 text-sm dark:border-amber-800/80 dark:bg-amber-950/35 print:border-amber-300 print:bg-amber-50"
                    >
                      <p className="font-semibold text-amber-950 dark:text-amber-100 print:text-black">{label}</p>
                      <ul className="mt-2 list-none space-y-3">
                        {rows.map((row) => (
                          <li key={row.id} className="border-l-2 border-amber-400 pl-3 print:border-amber-500">
                            <p className="text-xs text-gray-600 dark:text-gray-400 print:text-gray-800">
                              {row.created_at
                                ? format(new Date(row.created_at), 'dd MMM yyyy HH:mm')
                                : '—'}{' '}
                              · {row.author_name || 'Member'} · {formatSectionRoleLabel(row.author_role)}
                            </p>
                            {row.target_evidence_id ? (
                              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 print:text-gray-700">
                                Applies to one structured evidence entry (exhibit ref. {String(row.target_evidence_id).slice(0, 8)}…)
                              </p>
                            ) : null}
                            <p className="mt-1 whitespace-pre-wrap text-gray-900 dark:text-white print:text-black">
                              {row.body}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white print:text-black">Evidence</h2>
            {evidence.length === 0 && legacyPhotos.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">No evidence entries.</p>
            ) : (
              <ul className="mt-3 list-none space-y-6">
                {evidence.map((row) => {
                  const label = EVIDENCE_CATEGORY_LABELS[row.category] || row.category || 'Entry';
                  const urls = normalizeMediaUrls(row.media_urls);
                  return (
                    <li
                      key={row.id}
                      className="rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-600 print:break-inside-avoid"
                    >
                      <p className="font-medium text-gray-900 dark:text-white print:text-black">{label}</p>
                      <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300 print:text-gray-900">
                        {row.description?.trim() || '—'}
                      </p>
                      {urls.length > 0 ? (
                        <>
                          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 print:text-gray-700">
                            {urls.length} image{urls.length === 1 ? '' : 's'}
                          </p>
                          <EvidenceImageGrid urls={urls} altPrefix={label} />
                        </>
                      ) : null}
                    </li>
                  );
                })}
                {legacyPhotos.length > 0 && evidence.length === 0 && (
                  <li className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/20 print:break-inside-avoid">
                    <p className="font-medium text-amber-900 dark:text-amber-200 print:text-black">
                      Legacy incident photos
                    </p>
                    <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90 print:text-gray-800">
                      Uploaded before structured evidence; images are shown below.
                    </p>
                    <EvidenceImageGrid urls={legacyPhotos} altPrefix="Legacy evidence" />
                  </li>
                )}
              </ul>
            )}
          </section>

          {linkedProfiles.length > 0 && (
            <section className="mt-8 print:break-inside-avoid">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white print:text-black">
                Linked intelligence profiles
              </h2>
              <ul className="mt-3 list-none space-y-2 text-sm">
                {linkedProfiles.map((link) => (
                  <li key={link.id} className="text-gray-800 dark:text-gray-200 print:text-black">
                    {link.profile?.primary_name || 'Unknown profile'} ({link.profile?.risk_level || '—'} risk) —{' '}
                    {connectionTypeLabel(link.connection_type)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="mt-10 border-t border-gray-200 pt-4 text-center text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400 print:border-black print:text-gray-700">
            Neighbourhood Watch Platform — confidential — internal use only
          </footer>
        </article>
      </div>
    </div>
  );
}

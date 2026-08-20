import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { FaPen, FaArchive, FaTrash, FaTimes, FaImage, FaFilePdf, FaEnvelope, FaPhone, FaUser } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { canManageCityHubPost, canPublishCityHub, homeBackNav } from "../auth/roleMatrix";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import CityHubBanner from "../components/cityhub/CityHubBanner";
import { EMPTY_CITY_HUB_STATS, loadCityHubBannerStats } from "../utils/cityHubStats";
import { cityHubActorId, isCityHubPostUnread, markCityHubVisited, readCityHubLastSeen } from "../utils/cityHubUnread";
import {
  cityHubDocumentList,
  cityHubPhotoList,
  isCityHubPdf,
  MAX_CITY_HUB_DOCUMENTS,
  MAX_CITY_HUB_DOCUMENT_BYTES,
  MAX_CITY_HUB_PHOTOS,
  MAX_CITY_HUB_PHOTO_BYTES,
  uploadCityHubDocuments,
  uploadCityHubPhotos,
} from "../utils/cityHubPhotos";
import {
  cityHubAuthorDisplayName,
  cityHubAuthorInitials,
  cityHubAuthorRoleLabel,
  cityHubTelHref,
  fetchCityHubAuthorProfiles,
} from "../utils/cityHubAuthors";
import { parseCityHubContent } from "../utils/cityHubContent";
import { formatWatchDateTime } from "../utils/watchTime";

const POST_TYPES = [
  { value: "suspect_alert", label: "Suspect Alert" },
  { value: "pattern", label: "Pattern" },
  { value: "resource_request", label: "Resource Request" },
  { value: "general", label: "General" },
];

const POST_TYPE_CARD_ACCENT = {
  suspect_alert: "border-l-red-500 dark:border-l-red-400",
  pattern: "border-l-amber-500 dark:border-l-amber-400",
  resource_request: "border-l-sky-500 dark:border-l-sky-400",
  general: "border-l-slate-400 dark:border-l-slate-500",
};

const POST_TYPE_HEADLINE_STYLES = {
  suspect_alert:
    "bg-red-100 text-red-800 ring-1 ring-red-300/80 dark:bg-red-950/75 dark:text-red-200 dark:ring-red-500/45",
  pattern:
    "bg-amber-100 text-amber-950 ring-1 ring-amber-300/80 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-500/40",
  resource_request:
    "bg-sky-100 text-sky-900 ring-1 ring-sky-300/80 dark:bg-sky-950/70 dark:text-sky-200 dark:ring-sky-500/40",
  general:
    "bg-slate-100 text-slate-800 ring-1 ring-slate-300/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/40",
};

function cityHubPostTypeHeadline(type) {
  const option = POST_TYPES.find((item) => item.value === type);
  return {
    label: option?.label || String(type || "Alert").replaceAll("_", " "),
    className: POST_TYPE_HEADLINE_STYLES[type] || POST_TYPE_HEADLINE_STYLES.general,
  };
}

function CityHubDocumentList({ attachments }) {
  const docs = cityHubDocumentList({ document_attachments: attachments });
  if (docs.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {docs.map((doc) => (
        <li key={doc.url}>
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60"
          >
            <FaFilePdf className="shrink-0" aria-hidden />
            <span className="truncate">{doc.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function CityHubPhotoGrid({ urls, onOpen }) {
  const photos = cityHubPhotoList({ photo_urls: urls });
  if (photos.length === 0) return null;
  const single = photos.length === 1;
  return (
    <div className={`mt-3 grid gap-2 ${single ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
      {photos.map((url) => (
        <button
          key={url}
          type="button"
          onClick={() => onOpen?.(url)}
          className="group flex w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-100 p-1 text-left dark:border-gray-700 dark:bg-gray-900"
        >
          <img
            src={url}
            alt="City Hub attachment"
            className={`mx-auto h-auto w-auto max-w-full object-contain transition group-hover:opacity-90 ${
              single ? "max-h-[28rem]" : "max-h-64"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function CityHubMetaBox({ fields }) {
  if (!fields?.length) return null;
  return (
    <dl className="mt-3 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/60">
      {fields.map((field, fieldIndex) => (
        <div key={`${field.label}-${fieldIndex}`} className="py-1.5 first:pt-0 last:pb-0">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {field.label}
          </dt>
          <dd className="mt-0.5 break-words text-xs leading-5 text-gray-600 dark:text-gray-300">
            {field.value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CityHubPostBody({ title, content }) {
  const blocks = parseCityHubContent(content);
  const metaFields = blocks.filter((block) => block.kind === "meta").flatMap((block) => block.fields);
  const authorBlocks = blocks.filter((block) => block.kind === "author");
  const systemBlocks = blocks.filter((block) => block.kind === "system");

  return (
    <>
      <CityHubMetaBox fields={metaFields} />
      {title ? (
        <h3 className="mt-3 text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
      ) : null}
      {authorBlocks.length > 0 ? (
        <div className="mt-2 space-y-3">
          {authorBlocks.map((block, index) => (
            <div key={`author-${index}`}>
              {block.label ? (
                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">
                  {block.label}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-900 dark:text-gray-100">
                {block.text}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {systemBlocks.map((block, index) => (
        <p
          key={`system-${index}`}
          className="mt-3 border-t border-gray-200 pt-2 text-xs italic leading-5 text-gray-400 dark:border-gray-700 dark:text-gray-500"
        >
          {block.text}
        </p>
      ))}
    </>
  );
}

function CityHubAuthorSheet({ profile, organizationName, onClose }) {
  const name = cityHubAuthorDisplayName(profile);
  const phone = String(profile?.phone || "").trim();
  const email = String(profile?.email || "").trim();
  const telHref = cityHubTelHref(phone);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="city-hub-author-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-600">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
          <div className="flex min-w-0 items-center gap-3">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-12 w-12 rounded-full object-cover ring-2 ring-teal-200 dark:ring-teal-800"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700 dark:bg-teal-900/50 dark:text-teal-200">
                {cityHubAuthorInitials(profile)}
              </div>
            )}
            <div className="min-w-0">
              <h2 id="city-hub-author-title" className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                {name}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {cityHubAuthorRoleLabel(profile?.role)}
                {organizationName ? ` · ${organizationName}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            <FaTimes />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Use these details to get hold of the person who published this City Hub post.
          </p>
          <div className="flex items-start gap-3">
            <FaEnvelope className="mt-0.5 shrink-0 text-teal-500 dark:text-teal-400" />
            {email ? (
              <a
                href={`mailto:${email}`}
                className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300 break-all"
              >
                {email}
              </a>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">Email not provided</span>
            )}
          </div>
          <div className="flex items-start gap-3">
            <FaPhone className="mt-0.5 shrink-0 text-teal-500 dark:text-teal-400" />
            {telHref ? (
              <a
                href={telHref}
                className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
              >
                {phone}
              </a>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">Phone not provided</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CityHubEditModal({ post, busy, onClose, onSave }) {
  const [type, setType] = useState(post.type);
  const [title, setTitle] = useState(post.title || "");
  const [content, setContent] = useState(post.content || "");

  useEffect(() => {
    setType(post.type);
    setTitle(post.title || "");
    setContent(post.content || "");
  }, [post]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast.error("Title and content are required.");
      return;
    }
    void onSave({ type, title: title.trim(), content: content.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="city-hub-edit-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-600 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
          <h2 id="city-hub-edit-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Edit City Hub post
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
            disabled={busy}
          >
            <FaTimes />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0 space-y-3">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="input border w-full"
              disabled={busy}
            >
              {POST_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input border w-full"
              required
              disabled={busy}
            />
            <textarea
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
              required
              disabled={busy}
            />
          </div>
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !title.trim() || !content.trim()}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CityHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId } = useActiveOrganization();
  const allowPublish = canPublishCityHub(user?.role, user?.platformRole);
  const { backTo, backLabel } = homeBackNav(user?.role, user?.platformRole);
  const [posts, setPosts] = useState([]);
  const [bannerStats, setBannerStats] = useState(EMPTY_CITY_HUB_STATS);
  const [unreadPostIds, setUnreadPostIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [editingPost, setEditingPost] = useState(null);
  const visitSeenAtRef = useRef(readCityHubLastSeen(cityHubActorId(user)));
  const loadGenRef = useRef(0);
  const photoInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [pdfFiles, setPdfFiles] = useState([]);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [authorSheet, setAuthorSheet] = useState(null);
  const [form, setForm] = useState({
    type: "general",
    title: "",
    content: "",
    visibility: "city_wide",
  });

  const loadPosts = async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("city_hub_posts")
        .select("*")
        .in("status", ["published", "draft"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      if (gen !== loadGenRef.current) return;

      const basePosts = data || [];
      const authorOrgIds = Array.from(
        new Set(basePosts.map((post) => post.author_organization_id).filter(Boolean))
      );
      const authorUserIds = Array.from(
        new Set(basePosts.map((post) => post.created_by_user_id).filter(Boolean))
      );

      let orgNameById = new Map();
      if (authorOrgIds.length > 0) {
        const { data: orgRows, error: orgError } = await supabase
          .from("organizations")
          .select("id, name")
          .in("id", authorOrgIds);
        if (orgError) throw orgError;
        orgNameById = new Map((orgRows || []).map((org) => [org.id, org.name]));
      }
      if (gen !== loadGenRef.current) return;

      const authorsById = await fetchCityHubAuthorProfiles(supabase, authorUserIds);
      if (gen !== loadGenRef.current) return;
      const hydratedPosts = basePosts.map((post) => {
        const author = authorsById.get(String(post.created_by_user_id || "")) || null;
        return {
          ...post,
          author_profile: author,
          author_organization_name:
            orgNameById.get(post.author_organization_id) ||
            author?.organization_name ||
            "Organization",
        };
      });

      setPosts(hydratedPosts);
      const lastSeen = visitSeenAtRef.current;
      setUnreadPostIds(
        new Set(
          hydratedPosts
            .filter((post) => isCityHubPostUnread(post, lastSeen))
            .map((post) => post.id)
        )
      );

      try {
        setBannerStats(await loadCityHubBannerStats());
      } catch (statsErr) {
        console.warn(statsErr);
      }
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      console.error(err);
      toast.error("Could not load city hub posts.");
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const uid = cityHubActorId(user);
    visitSeenAtRef.current = readCityHubLastSeen(uid);
    if (uid) markCityHubVisited(uid);
    void loadPosts();
    return () => {
      if (uid) markCityHubVisited(uid);
    };
  }, [user?.id, user?.uid]);

  const photoFilesRef = useRef(photoFiles);
  photoFilesRef.current = photoFiles;
  useEffect(() => {
    return () => {
      photoFilesRef.current.forEach((item) => {
        if (item.preview) URL.revokeObjectURL(item.preview);
      });
    };
  }, []);

  const resetPhotoFiles = () => {
    setPhotoFiles((prev) => {
      prev.forEach((item) => {
        if (item.preview) URL.revokeObjectURL(item.preview);
      });
      return [];
    });
    if (photoInputRef.current) photoInputRef.current.value = "";
    setPdfFiles([]);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  const handlePhotoChange = (event) => {
    const incoming = Array.from(event.target.files || []);
    if (incoming.length === 0) return;
    const next = [...photoFiles];
    for (const file of incoming) {
      if (next.length >= MAX_CITY_HUB_PHOTOS) {
        toast.error(`You can attach up to ${MAX_CITY_HUB_PHOTOS} photos.`);
        break;
      }
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} is not an image.`);
        continue;
      }
      if (file.size > MAX_CITY_HUB_PHOTO_BYTES) {
        toast.error(`${file.name} is larger than 10MB.`);
        continue;
      }
      next.push({ file, preview: URL.createObjectURL(file) });
    }
    setPhotoFiles(next);
    event.target.value = "";
  };

  const removePhotoAt = (index) => {
    setPhotoFiles((prev) => {
      const copy = [...prev];
      const [removed] = copy.splice(index, 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  };

  const removePdfAt = (index) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePdfChange = (event) => {
    const incoming = Array.from(event.target.files || []);
    if (incoming.length === 0) return;
    const next = [...pdfFiles];
    for (const file of incoming) {
      if (next.length >= MAX_CITY_HUB_DOCUMENTS) {
        toast.error(`You can attach up to ${MAX_CITY_HUB_DOCUMENTS} PDFs.`);
        break;
      }
      if (!isCityHubPdf(file)) {
        toast.error(`${file.name} is not a PDF.`);
        continue;
      }
      if (file.size > MAX_CITY_HUB_DOCUMENT_BYTES) {
        toast.error(`${file.name} is larger than 20MB.`);
        continue;
      }
      next.push(file);
    }
    setPdfFiles(next);
    event.target.value = "";
  };

  const createPost = async (event) => {
    event.preventDefault();
    if (!allowPublish) {
      toast.error("You have view-only access to city hub.");
      return;
    }
    if (!form.title.trim() || !form.content.trim()) {
      toast.error("Title and content are required.");
      return;
    }
    const authorOrgId = activeOrganizationId || user.organizationId;
    if (!authorOrgId) {
      toast.error("Select a neighbourhood before publishing.");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const { data: inserted, error } = await supabase
        .from("city_hub_posts")
        .insert({
          author_organization_id: authorOrgId,
          type: form.type,
          title: form.title.trim(),
          content: form.content.trim(),
          visibility: form.visibility,
          status: "published",
          created_by_user_id: user.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (photoFiles.length > 0 && inserted?.id) {
        try {
          const urls = await uploadCityHubPhotos(
            inserted.id,
            photoFiles.map((item) => item.file)
          );
          if (urls.length > 0) {
            const { error: photoError } = await supabase
              .from("city_hub_posts")
              .update({ photo_urls: urls })
              .eq("id", inserted.id);
            if (photoError) throw photoError;
          }
        } catch (photoErr) {
          console.warn(photoErr);
          toast.error(
            photoErr.message ||
              "Post published, but photos could not be saved. Run the City Hub photos SQL if this continues."
          );
        }
      }

      if (pdfFiles.length > 0 && inserted?.id) {
        try {
          const docs = await uploadCityHubDocuments(inserted.id, pdfFiles);
          if (docs.length > 0) {
            const { error: docError } = await supabase
              .from("city_hub_posts")
              .update({ document_attachments: docs })
              .eq("id", inserted.id);
            if (docError) throw docError;
          }
        } catch (docErr) {
          console.warn(docErr);
          toast.error(
            docErr.message ||
              "Post published, but PDFs could not be saved. Run the City Hub PDF SQL if this continues."
          );
        }
      }

      setForm({ type: "general", title: "", content: "", visibility: "city_wide" });
      resetPhotoFiles();
      toast.success("City hub post published.");
      await loadPosts();
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not publish post.");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async ({ type, title, content }) => {
    if (!editingPost || busyId) return;
    setBusyId(editingPost.id);
    try {
      const { error } = await supabase.rpc("update_city_hub_post", {
        p_post_id: editingPost.id,
        p_type: type,
        p_title: title,
        p_content: content,
      });
      if (error) throw error;
      toast.success("Post updated.");
      setEditingPost(null);
      await loadPosts();
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not update post.");
    } finally {
      setBusyId(null);
    }
  };

  const archivePost = async (post) => {
    if (busyId) return;
    if (!window.confirm("Archive this post? It will leave the city-wide feed. Shared incidents can be posted again.")) {
      return;
    }
    setBusyId(post.id);
    try {
      const { error } = await supabase.rpc("archive_city_hub_post", { p_post_id: post.id });
      if (error) throw error;
      toast.success("Post archived.");
      await loadPosts();
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not archive post.");
    } finally {
      setBusyId(null);
    }
  };

  const deletePost = async (post) => {
    if (busyId) return;
    if (!window.confirm("Permanently delete this post? This cannot be undone.")) {
      return;
    }
    setBusyId(post.id);
    try {
      const { error } = await supabase.rpc("delete_city_hub_post", { p_post_id: post.id });
      if (error) throw error;
      toast.success("Post deleted.");
      await loadPosts();
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not delete post.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <CityHubBanner
          backLabel={backLabel}
          allowPublish={allowPublish}
          stats={bannerStats}
          onBack={() => navigate(backTo)}
        />

        {allowPublish ? (
          <form onSubmit={createPost} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Publish update</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <select
                value={form.type}
                onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                className="input border w-full"
              >
                {POST_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <select
                value={form.visibility}
                onChange={(e) => setForm((prev) => ({ ...prev, visibility: e.target.value }))}
                className="input border w-full"
              >
                <option value="city_wide">City-wide</option>
                <option value="radius">Radius-based</option>
                <option value="specific_suburbs">Specific suburbs</option>
              </select>
            </div>
            <input
              type="text"
              placeholder="Post title"
              className="input border w-full"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
            <textarea
              rows={4}
              placeholder="What should other NW admins know?"
              className="w-full border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
              value={form.content}
              onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
              required
            />
            <div className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                  <FaImage className="text-teal-600 dark:text-teal-400" aria-hidden />
                  Photo attachments
                </label>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Optional · up to {MAX_CITY_HUB_PHOTOS} images · 10MB each
                </span>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                multiple
                onChange={handlePhotoChange}
                className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-teal-700 dark:text-gray-300"
              />
              {photoFiles.length > 0 ? (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {photoFiles.map((item, index) => (
                    <div key={`${item.file.name}-${index}`} className="relative">
                      <img
                        src={item.preview}
                        alt=""
                        className="mx-auto h-20 w-auto max-w-full rounded-md object-contain bg-gray-100 dark:bg-gray-900"
                      />
                      <button
                        type="button"
                        onClick={() => removePhotoAt(index)}
                        className="absolute -right-1 -top-1 rounded-full bg-gray-900 p-1 text-white shadow dark:bg-gray-100 dark:text-gray-900"
                        aria-label="Remove photo"
                      >
                        <FaTimes className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                  <FaFilePdf className="text-rose-600 dark:text-rose-400" aria-hidden />
                  PDF attachments
                </label>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Optional · up to {MAX_CITY_HUB_DOCUMENTS} files · 20MB each
                </span>
              </div>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={handlePdfChange}
                className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-rose-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-rose-700 dark:text-gray-300"
              />
              {pdfFiles.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {pdfFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900"
                    >
                      <span className="truncate text-gray-800 dark:text-gray-200">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePdfAt(index)}
                        className="rounded-full p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                        aria-label="Remove PDF"
                      >
                        <FaTimes className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Publishing..." : "Publish post"}
            </button>
          </form>
        ) : (
          <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              You have view-only access. Posting is limited to admin roles.
            </p>
          </section>
        )}

        <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Latest updates</h2>
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading posts...</p>
          ) : posts.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No city-hub posts yet.</p>
          ) : (
            <div className="space-y-5">
              {posts.map((post) => {
                const canManage = canManageCityHubPost(user?.role, user?.id, post, user?.platformRole);
                const busy = busyId === post.id;
                const unread = unreadPostIds.has(post.id);
                const typeHeadline = cityHubPostTypeHeadline(post.type);
                const typeAccent = POST_TYPE_CARD_ACCENT[post.type] || POST_TYPE_CARD_ACCENT.general;
                return (
                  <article
                    key={post.id}
                    className={`rounded-xl border-y border-r border-l-4 border-y-gray-200 border-r-gray-200 p-4 shadow-sm sm:p-5 dark:border-y-gray-600 dark:border-r-gray-600 ${typeAccent} ${
                      unread
                        ? "bg-red-50/90 ring-2 ring-red-500/80 shadow-[0_0_12px_rgba(239,68,68,0.22)] dark:bg-red-950/40"
                        : "bg-gray-50 ring-1 ring-gray-200/90 dark:bg-gray-900/50 dark:shadow-none dark:ring-white/10"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {unread ? (
                          <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wide">
                            New
                          </span>
                        ) : null}
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${typeHeadline.className}`}
                        >
                          {typeHeadline.label}
                        </span>
                        <span
                          className="inline-flex max-w-full items-center rounded-md bg-teal-100 px-2 py-1 text-xs font-semibold text-teal-900 ring-1 ring-teal-300/80 dark:bg-teal-950/70 dark:text-teal-200 dark:ring-teal-500/40"
                          title="Posted by"
                        >
                          {post.author_organization_name || "Organization"}
                        </span>
                        {post.author_profile ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAuthorSheet({
                                profile: post.author_profile,
                                organizationName: post.author_organization_name,
                              })
                            }
                            className="inline-flex max-w-full items-center gap-1 text-xs font-semibold text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                            title="View author contact details"
                          >
                            <FaUser className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="truncate">{cityHubAuthorDisplayName(post.author_profile)}</span>
                          </button>
                        ) : null}
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatWatchDateTime(post.created_at) || "—"}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-[11px] capitalize text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {post.status}
                        </span>
                      </div>
                      {canManage ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingPost(post)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 disabled:opacity-50"
                          >
                            <FaPen className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => archivePost(post)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 disabled:opacity-50"
                          >
                            <FaArchive className="w-3 h-3" />
                            Archive
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePost(post)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 disabled:opacity-50"
                          >
                            <FaTrash className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <CityHubPostBody title={post.title} content={post.content} />
                    <CityHubPhotoGrid urls={post.photo_urls} onOpen={setLightboxUrl} />
                    <CityHubDocumentList attachments={post.document_attachments} />
                    {post.related_incident_id ? (
                      <p className="text-xs text-sky-700 dark:text-sky-300 mt-2">Shared from an approved incident report</p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {authorSheet ? (
        <CityHubAuthorSheet
          profile={authorSheet.profile}
          organizationName={authorSheet.organizationName}
          onClose={() => setAuthorSheet(null)}
        />
      ) : null}

      {editingPost ? (
        <CityHubEditModal
          post={editingPost}
          busy={busyId === editingPost.id}
          onClose={() => {
            if (!busyId) setEditingPost(null);
          }}
          onSave={saveEdit}
        />
      ) : null}

      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLightboxUrl(null);
          }}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-gray-900"
            aria-label="Close photo"
          >
            <FaTimes />
          </button>
          <img
            src={lightboxUrl}
            alt="City Hub attachment"
            className="h-auto w-auto max-h-[92vh] max-w-[96vw] rounded-lg object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import { FaFilePdf } from "react-icons/fa";
import { cityHubDocumentList, cityHubPhotoList, CITY_HUB_PHOTO_BUCKET } from "../../../utils/cityHubPhotos";
import { parseCityHubContent } from "../../../utils/cityHubContent";
import { useSignedMediaSrcList } from "../../../utils/privateMedia";

function CityHubDocumentLink({ doc }) {
  const [href] = useSignedMediaSrcList([doc.url], CITY_HUB_PHOTO_BUCKET);
  if (!href) {
    return (
      <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
        <FaFilePdf className="shrink-0" aria-hidden />
        <span className="truncate">{href === null ? "Document unavailable" : doc.name}</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60"
    >
      <FaFilePdf className="shrink-0" aria-hidden />
      <span className="truncate">{doc.name}</span>
    </a>
  );
}

function CityHubDocumentList({ attachments }) {
  const docs = cityHubDocumentList({ document_attachments: attachments });
  if (docs.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {docs.map((doc) => (
        <li key={doc.url}>
          <CityHubDocumentLink doc={doc} />
        </li>
      ))}
    </ul>
  );
}

function CityHubPhotoButton({ src, single, onOpen }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="flex w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-100 px-2 py-6 text-center text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
        {src === null || broken ? "Photo unavailable" : ""}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen?.(src)}
      className="group flex w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-100 p-1 text-left dark:border-gray-700 dark:bg-gray-900"
    >
      <img
        src={src}
        alt="City Hub attachment"
        className={`mx-auto h-auto w-auto max-w-full object-contain transition group-hover:opacity-90 ${
          single ? "max-h-[28rem]" : "max-h-64"
        }`}
        onError={() => setBroken(true)}
      />
    </button>
  );
}

function CityHubPhotoGrid({ urls, onOpen }) {
  const photos = cityHubPhotoList({ photo_urls: urls });
  const signed = useSignedMediaSrcList(photos, CITY_HUB_PHOTO_BUCKET);
  if (photos.length === 0) return null;
  const single = photos.length === 1;
  return (
    <div className={`mt-3 grid gap-2 ${single ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
      {photos.map((stored, index) => (
        <CityHubPhotoButton key={stored} src={signed[index]} single={single} onOpen={onOpen} />
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

export {
  CityHubDocumentLink,
  CityHubDocumentList,
  CityHubPhotoButton,
  CityHubPhotoGrid,
  CityHubMetaBox,
  CityHubPostBody,
};

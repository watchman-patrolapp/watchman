import { FaEnvelope, FaGlobe, FaPhone, FaWhatsapp } from "react-icons/fa";
import { telUrl, whatsappUrl } from "../../utils/localServices";

const BTN =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white";

export default function ServiceContactButtons({ phone, whatsapp, email, website }) {
  const tel = telUrl(phone);
  const wa = whatsappUrl(whatsapp);
  const safeSite = /^https?:\/\//i.test(website || "") ? website : "";
  if (!tel && !wa && !email && !safeSite) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {tel ? (
        <a href={tel} className={`${BTN} bg-teal-600 hover:bg-teal-700`}>
          <FaPhone className="h-3 w-3" aria-hidden /> Call
        </a>
      ) : null}
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={`${BTN} bg-emerald-600 hover:bg-emerald-700`}>
          <FaWhatsapp className="h-3.5 w-3.5" aria-hidden /> WhatsApp
        </a>
      ) : null}
      {email ? (
        <a href={`mailto:${email}`} className={`${BTN} bg-slate-700 hover:bg-slate-800`}>
          <FaEnvelope className="h-3 w-3" aria-hidden /> Email
        </a>
      ) : null}
      {safeSite ? (
        <a href={safeSite} target="_blank" rel="noopener noreferrer" className={`${BTN} bg-indigo-600 hover:bg-indigo-700`}>
          <FaGlobe className="h-3 w-3" aria-hidden /> Website
        </a>
      ) : null}
    </div>
  );
}

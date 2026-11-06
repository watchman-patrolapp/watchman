import { useCallback, useState } from 'react';
import { supabase } from '../../supabase/client';
import toast from '../../utils/notify';
import { formatWatchDateTime } from '../../utils/watchTime';
import { getWorkingOrganizationId } from '../../utils/organizationScope';
import { localDateTimeParts, summarizeMessageForReply } from '../utils/chatMessageMerge';
import {
  buildCompiledIncidentInsert,
  compiledReportValidationError,
} from '../utils/compiledIncidentReport';

export function useChatIncidentReport(user) {
  const [reportDraft, setReportDraft] = useState(null);

  const handleCompileReport = useCallback((message) => {
    const summary = summarizeMessageForReply(message);
    const when = localDateTimeParts();
    setReportDraft({
      sourceMessageId: message?.id || null,
      type: 'Suspicious Activity',
      location: message?.location_address || '',
      description:
        `Compiled from emergency chat (${formatWatchDateTime(message?.created_at) || formatWatchDateTime(new Date()) || 'now'}):\n` +
        `Initial message by: ${message?.sender_name || 'Unknown'}\n` +
        `Compiled into report by: ${user?.fullName || user?.email || 'Unknown'}\n` +
        `${summary}`,
      suspectName: '',
      incidentDate: when.date,
      incidentTime: when.time,
      pinLat: message?.location_lat ?? null,
      pinLng: message?.location_lng ?? null,
      showMapPicker: false,
      sourceSenderName: message?.sender_name || 'Unknown',
      compiledByName: user?.fullName || user?.email || 'Unknown',
    });
  }, [user?.email, user?.fullName]);

  const handleSaveCompiledReport = useCallback(async () => {
    const validationError = compiledReportValidationError(reportDraft);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    try {
      const payload = buildCompiledIncidentInsert(reportDraft, {
        userId: user.id,
        submittedByName: user.fullName || user.email,
        organizationId: getWorkingOrganizationId() || user.organizationId || null,
      });
      const { error } = await supabase.from('incidents').insert(payload);
      if (error) throw error;
      toast.success('Incident compiled and saved');
      setReportDraft(null);
    } catch (err) {
      toast.error(`Could not save report: ${err.message || 'unknown error'}`);
    }
  }, [reportDraft, user]);

  return {
    reportDraft,
    setReportDraft,
    handleCompileReport,
    handleSaveCompiledReport,
  };
}

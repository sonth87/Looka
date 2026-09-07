import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, Campaign, deleteCampaign, updateCampaign } from '../api';

/**
 * "Gia hạn" (extend) and "Xóa" (delete) — the two destructive/quick-edit
 * campaign actions, shared between `CampaignList`'s row actions and
 * `CampaignDetail`'s (the view page) header, so both places call the exact
 * same API/confirmation logic instead of two copies drifting apart (Part 3/4
 * of the 2026-09-07 campaign-pages redesign — see docs/ROADMAP.md).
 *
 * `compact` switches between the list row's plain text-link style (matching
 * the existing "Xem →" convention) and the view page header's bordered
 * pill-button style (matching its "Sửa" button).
 */
export function CampaignDangerActions({
  campaign,
  onExtended,
  onDeleted,
  compact = false,
}: {
  campaign: Campaign;
  onExtended: (updated: Campaign) => void;
  onDeleted: () => void;
  compact?: boolean;
}) {
  const [modal, setModal] = useState<'extend' | 'delete' | null>(null);

  const extendClass = compact
    ? 'text-amber-600 hover:text-amber-800 font-medium'
    : 'px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-semibold';
  const deleteClass = compact
    ? 'text-red-600 hover:text-red-800 font-medium'
    : 'px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-semibold';

  return (
    <>
      <button onClick={() => setModal('extend')} className={extendClass}>
        Gia hạn
      </button>
      <button onClick={() => setModal('delete')} className={deleteClass}>
        Xóa
      </button>

      {modal === 'extend' && (
        <ExtendModal
          campaign={campaign}
          onClose={() => setModal(null)}
          onExtended={(updated) => {
            setModal(null);
            onExtended(updated);
          }}
        />
      )}
      {modal === 'delete' && (
        <DeleteModal
          campaign={campaign}
          onClose={() => setModal(null)}
          onDeleted={() => {
            setModal(null);
            onDeleted();
          }}
        />
      )}
    </>
  );
}

/**
 * Small centered modal shell — same overlay pattern as `SessionDetailDrawer`,
 * just centered instead of a side drawer since these dialogs are one field /
 * one confirmation, not a browsing surface. Exported so other confirmation
 * dialogs (e.g. `DevicesPanel`'s reissue-on-an-activated-device confirm)
 * share the same visual language instead of inventing another modal style.
 */
export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/**
 * One field only (new expiry date) — deliberately not the full edit page, so
 * "extend a campaign that's about to expire" stays a two-click action from
 * the list instead of a detour through every other setting (see the product
 * request: "Gia hạn" must be a quick inline action, not full edit).
 */
function ExtendModal({
  campaign,
  onClose,
  onExtended,
}: {
  campaign: Campaign;
  onClose: () => void;
  onExtended: (updated: Campaign) => void;
}) {
  const [expiresAt, setExpiresAt] = useState(campaign.expiresAt ? campaign.expiresAt.slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await updateCampaign(campaign.id, {
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      onExtended(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Gia hạn "${campaign.name}"`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Hạn dùng mới (để trống = vĩnh viễn)</label>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </div>
        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
          >
            Huỷ
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : 'Gia hạn'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Typed confirmation (must retype the exact campaign name) rather than a
 * bare `window.confirm` — this codebase has no existing destructive-action
 * pattern to match (no other delete exists in the CMS yet), and a hard
 * campaign delete is irreversible and, per the backend's 409 rule, cascades
 * onto real device rows when allowed to proceed — worth more friction than
 * an OK/Cancel dialog.
 */
function DeleteModal({
  campaign,
  onClose,
  onDeleted,
}: {
  campaign: Campaign;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDelete = confirmText.trim() === campaign.name;

  const submit = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteCampaign(campaign.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ModalShell title={`Xóa campaign "${campaign.name}"`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">Thao tác này không thể hoàn tác.</p>
        <p className="text-gray-600">
          Chỉ có thể xóa khi campaign <strong>chưa có thiết bị hoặc phiên chụp nào</strong> — nếu đã có, hệ thống sẽ
          từ chối và bạn cần gỡ thiết bị trước.
        </p>
        <p className="text-gray-600">
          Gõ lại tên campaign <strong>{campaign.name}</strong> để xác nhận:
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          autoFocus
        />
        {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
            Huỷ
          </button>
          <button
            onClick={submit}
            disabled={!canDelete || deleting}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-50"
          >
            {deleting ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

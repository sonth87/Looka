/**
 * Client for apps/api's device-management module — see
 * docs/plans/multi-camera-device-management-discussion.md §3.4. Types here
 * are a deliberate, separate copy of the server's DAOs: this is a real REST
 * boundary (a different app, a different build), not internal duplication
 * to avoid — the server is free to change its DAO shape without this file
 * needing a workspace dependency on a NestJS app.
 */

export type CampaignPurpose = 'STUDENT_CARD' | 'KYC_ENROLLMENT';
export type CaptureTriggerMode = 'AUTO' | 'MANUAL' | 'OFF';
export type DeviceStatus = 'REGISTERED' | 'ACTIVATED';

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  purpose: CampaignPurpose;
  expiresAt?: string | null;
  consentContent?: string | null;
  consentVersion: number;
  captureAngles?: Record<string, unknown>[] | null;
  captureMode?: CaptureTriggerMode | null;
  autoHoldMs?: number | null;
  simultaneousCapture: boolean;
  recordVideo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  campaignId: string;
  name: string;
  authApiEndpoint?: string;
  status: DeviceStatus;
  activatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  name: string;
  description?: string;
  purpose?: CampaignPurpose;
  expiresAt?: string;
  consentContent?: string;
  captureAngles?: Record<string, unknown>[];
  captureMode?: CaptureTriggerMode;
  autoHoldMs?: number;
  simultaneousCapture?: boolean;
  recordVideo?: boolean;
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  expiresAt?: string | null;
  consentContent?: string;
  captureAngles?: Record<string, unknown>[];
  captureMode?: CaptureTriggerMode;
  autoHoldMs?: number;
  simultaneousCapture?: boolean;
  recordVideo?: boolean;
}

export type DesktopOs = 'mac' | 'win';

export interface CreateDeviceInput {
  name: string;
  authApiEndpoint?: string;
  os?: DesktopOs;
}

export interface CampaignStats {
  campaignId: string;
  deviceCount: number;
  sessionsCompleted: number;
  uploadSuccess: number;
  uploadFailed: number;
  retakes: number;
  cbHelpInterventions: number;
}

export interface CampaignStatsSummaryItem extends CampaignStats {
  campaignName: string;
}

export interface AllCampaignsStats {
  totalCampaigns: number;
  totalDevices: number;
  totalSessionsCompleted: number;
  totalUploadSuccess: number;
  totalUploadFailed: number;
  totalRetakes: number;
  totalCbHelpInterventions: number;
  campaigns: CampaignStatsSummaryItem[];
}

const API_KEY_STORAGE = 'looka-cms-api-key';

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

function baseUrl(): string {
  return (window as any).LOOKA_API_BASE_URL ?? 'http://localhost:3100';
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Every JSON response is `{ statusCode, message, data }` — apps/api's global ResponseTransformInterceptor. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300) || res.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      /* not JSON; the raw text is the best available */
    }
    throw new ApiError(message, res.status);
  }

  const envelope = (await res.json()) as { data: T };
  return envelope.data;
}

export const listCampaigns = () => request<Campaign[]>('/v1/campaigns');
export const getCampaign = (id: string) => request<Campaign>(`/v1/campaigns/${id}`);
export const createCampaign = (input: CreateCampaignInput) =>
  request<Campaign>('/v1/campaigns', { method: 'POST', body: JSON.stringify(input) });
export const updateCampaign = (id: string, input: UpdateCampaignInput) =>
  request<Campaign>(`/v1/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const getCampaignStats = (campaignId: string) => request<CampaignStats>(`/v1/campaigns/${campaignId}/stats`);
export const getAllCampaignsStats = () => request<AllCampaignsStats>('/v1/campaigns/stats/summary');

export const listDevices = (campaignId: string) => request<Device[]>(`/v1/campaigns/${campaignId}/devices`);
export const getDevice = (id: string) => request<Device>(`/v1/devices/${id}`);

/**
 * Registers a device and returns its activation zip — the one response on
 * this client that is not the JSON envelope (see DeviceController's own doc
 * comment: it's a `StreamableFile`, deliberately excluded from that
 * wrapping). The filename comes from the server's `Content-Disposition`
 * header rather than being reconstructed here, so it stays correct if that
 * naming ever changes server-side.
 */
export async function registerDevice(
  campaignId: string,
  input: CreateDeviceInput
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${baseUrl()}/v1/campaigns/${campaignId}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': getApiKey() },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(text.slice(0, 300) || res.statusText, res.status);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `looka-kiosk-${Date.now()}.zip`;

  return { blob: await res.blob(), filename };
}

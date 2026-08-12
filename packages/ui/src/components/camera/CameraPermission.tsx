import React from 'react';
import { cn } from '../../lib/utils.js';

export interface CameraPermissionProps {
  status: 'requesting' | 'denied';
  onRequestPermission?: () => void;
  className?: string;
}

export const CameraPermission: React.FC<CameraPermissionProps> = ({
  status,
  onRequestPermission,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-6 text-center bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl max-w-md mx-auto',
        className
      )}
    >
      <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 mb-4 border border-blue-500/20">
        <svg
          className="w-7 h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-slate-100 mb-1">
        {status === 'requesting' ? 'Yêu cầu quyền truy cập Camera' : 'Quyền truy cập Camera bị từ chối'}
      </h3>

      <p className="text-sm text-slate-400 mb-5 leading-relaxed">
        {status === 'requesting'
          ? 'Ứng dụng cần quyền sử dụng camera để thực hiện chụp ảnh và nhận diện khuôn mặt.'
          : 'Vui lòng kiểm tra và cấp quyền camera trong cài đặt trình duyệt/hệ điều hành để tiếp tục.'}
      </p>

      {onRequestPermission && status === 'requesting' && (
        <button
          onClick={onRequestPermission}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
        >
          Cấp quyền Camera
        </button>
      )}
    </div>
  );
};

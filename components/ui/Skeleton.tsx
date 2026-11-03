export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-[#EBE7DF] rounded-[6px] ${className}`}
      aria-hidden="true"
    />
  );
}

export function RoomDashboardSkeleton() {
  return (
    <div className="w-full space-y-6">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="lg:col-span-2 h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function ParticipantVoteSkeleton() {
  return (
    <div className="w-full max-w-xl mx-auto space-y-5">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-14 w-full" />
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

export function ParticipantFeedbackSkeleton() {
  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <Skeleton className="h-24 w-full" />
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="w-full space-y-4 py-4">
      <div className="h-6 w-48 bg-[#D9D5CC]/40 rounded-[4px] animate-pulse" />
      <div className="h-4 w-72 bg-[#D9D5CC]/30 rounded-[4px] animate-pulse" />
      <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-28 bg-white border border-[#D9D5CC] rounded-[6px]" />
        <div className="h-28 bg-white border border-[#D9D5CC] rounded-[6px]" />
      </div>
    </div>
  );
}

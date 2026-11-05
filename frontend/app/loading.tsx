export default function GlobalLoading() {
  return (
    <div className="flex-1 flex items-center justify-center p-6 min-h-[50vh]">
      <div className="space-y-2 text-center">
        <div className="w-8 h-1 bg-[#E4572E] mx-auto rounded-[4px]" />
        <p className="text-xs text-[#5A554E] font-mono">Cargando...</p>
      </div>
    </div>
  );
}

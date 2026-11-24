export default function GlobalLoading() {
  return (
    <div className="flex-1 flex items-center justify-center p-6 min-h-[50vh]">
      <div className="space-y-2 text-center">
        <div className="w-8 h-1 bg-brand mx-auto rounded-[4px]" />
        <p className="text-xs text-ink-2 font-mono">Cargando...</p>
      </div>
    </div>
  );
}

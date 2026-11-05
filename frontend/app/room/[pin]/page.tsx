import ParticipantJoinForm from '@/components/ParticipantJoinForm';

interface RoomJoinPageProps {
  params: {
    pin: string;
  };
}

export default function RoomJoinDirectPage({ params }: RoomJoinPageProps) {
  const pin = params?.pin || '';

  return (
    <main className="flex-1 flex flex-col justify-center px-4 py-8 sm:py-16 bg-[#F6F4EF]">
      <ParticipantJoinForm initialPin={pin} />
    </main>
  );
}

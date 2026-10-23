export default function ReviewPage({ params }: { params: { id: string } }) {
  return <article>Review {params.id}</article>;
}

type StarRatingProps = { value: number; max?: number; onChange?: (value: number) => void };

export function StarRating({ value, max = 5, onChange }: StarRatingProps) {
  return (
    <div role="radiogroup">
      {Array.from({ length: max }, (_, i) => (
        <button key={i} type="button" aria-checked={i < value} onClick={() => onChange?.(i + 1)}>
          ★
        </button>
      ))}
    </div>
  );
}

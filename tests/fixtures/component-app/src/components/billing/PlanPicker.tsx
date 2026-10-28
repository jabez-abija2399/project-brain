export function PlanPicker({ plans }: { plans: string[] }) {
  return (
    <ul>
      {plans.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

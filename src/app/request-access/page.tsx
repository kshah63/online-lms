import { RequestAccessForm } from "@/components/auth/request-access-form";
import { BrandWordmark } from "@/components/brand";

export default function RequestAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <BrandWordmark size={32} textClassName="text-lg" />
        </div>
        <RequestAccessForm />
      </div>
    </div>
  );
}

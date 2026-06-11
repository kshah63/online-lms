// MathVision Global brand.
export const colors = {
  primary: "#F05A29", // orange
  indigo: "#2D3092",
  bg: "#F6F7FB",
  card: "#FFFFFF",
  border: "#E6E8EF",
  text: "#1A1C28",
  muted: "#6B7080",
  success: "#1F9D6B",
  warning: "#C97A12",
  danger: "#D6453B",
  white: "#FFFFFF",
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export function roleColor(role: string): string {
  switch (role) {
    case "admin":
      return colors.indigo;
    case "teacher":
      return colors.primary;
    case "student":
      return "#2F8F6B";
    case "parent":
      return "#7A5AC9";
    default:
      return colors.muted;
  }
}

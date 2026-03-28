// ==========================================
// PATROL COLOR MANAGEMENT - 10/10 Solution
// ==========================================

// Vibrant color palette for patrol officers (distinct, accessible)
export const PATROL_COLORS = [
  '#e74c3c', // Red (primary user)
  '#3498db', // Blue
  '#2ecc71', // Green
  '#f39c12', // Orange
  '#9b59b6', // Purple
  '#1abc9c', // Teal
  '#e91e63', // Pink
  '#00bcd4', // Cyan
  '#ff5722', // Deep Orange
  '#3f51b5', // Indigo
  '#4caf50', // Light Green
  '#ff9800', // Amber
];

// Vehicle type colors (for legend consistency)
export const VEHICLE_COLORS = {
  on_foot: '#14b8a6',   // teal-500
  bicycle: '#6366f1',   // indigo-500
  vehicle: '#3b82f6',   // blue-500
  car: '#3b82f6',
};

// Assign color to user (persistent per session)
const userColorMap = new Map();

export const getUserColor = (userId) => {
  if (!userColorMap.has(userId)) {
    const index = userColorMap.size % PATROL_COLORS.length;
    userColorMap.set(userId, PATROL_COLORS[index]);
  }
  return userColorMap.get(userId);
};

// Get first name for label
export const getFirstName = (fullName) => {
  if (!fullName) return 'Unknown';
  return fullName.split(' ')[0];
};

// Reset colors (call when admin logs out if needed)
export const resetPatrolColors = () => {
  userColorMap.clear();
};
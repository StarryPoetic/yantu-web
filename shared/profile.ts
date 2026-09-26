/** Transport contract shared by the server and UI; contains no demo defaults or persistence. */
export interface Profile {
  name: string;
  university: string;
  major: string;
  graduation: string;
  year: string;
  english: string;
  math: string;
  hours: string;
  budget: string;
  cities: string[];
  crossMajor: string;
  priorities: Record<string, number>;
  preparation?: string;
  courses?: string;
  notes?: string;
  targetMajor?: string;
  studyGoal?: string;
  degreePreference?: string;
}

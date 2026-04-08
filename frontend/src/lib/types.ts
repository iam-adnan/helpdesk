export interface Ticket {
  id: string; ticket_number: string; subject: string; description: string;
  status: string; priority: string; category: string; support_team: string;
  created_by: User; assigned_to: User | null; tags: string[];
  created_at: string; updated_at: string; comment_count?: number;
  comments?: Comment[]; activities?: Activity[]; attachments?: any[];
}
export interface User {
  id: string; email: string; username: string; first_name: string; last_name: string;
  role: string; department: string; is_active: boolean; avatar: string | null;
}
export interface Comment {
  id: string; author: User; content: string; comment_type: string;
  created_at: string; updated_at: string;
}
export interface Activity {
  id: string; user: User; action: string; old_value: string; new_value: string; created_at: string;
}
export interface Notification {
  id: string; title: string; message: string; channel: string;
  status: string; read: boolean; ticket_id: string | null; created_at: string;
}

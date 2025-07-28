import axios from 'axios';

// Type definitions
export interface Team {
  id: number;
  name: string;
  description: string;
  members: number;
  leader: string;
  created: string;
  bytebridges: number;
  owner: TeamMemberBasic;
  admins: TeamMemberBasic[];
  regularMembers: TeamMemberBasic[];
}

export interface TeamMemberBasic {
  id: number;
  name: string;
}

export interface TeamMember extends TeamMemberBasic {
  role: string;
  avatar: string;
  email: string;
  phone: string;
  skills: string[];
  bio: string;
}

/**
 * Test function to check if the teams API endpoint is available
 * @returns Promise resolving to API status
 */
export const testTeamsEndpoint = async (): Promise<{ status: string; message: string }> => {
  try {
    const response = await axios.get('/api/teams/');
    
    return {
      status: 'success',
      message: `Teams API is available. Status: ${response.status}`
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Handle Axios errors with more detail
      const statusCode = error.response?.status || 'unknown';
      const errorMessage = error.response?.data?.detail || error.message;
      
      return {
        status: 'error',
        message: `Teams API error: ${statusCode} - ${errorMessage}`
      };
    }
    
    // Handle non-Axios errors
    return {
      status: 'error',
      message: `Teams API error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};

/**
 * Get teams that the current user is a member of
 */
export const getMyTeams = async (): Promise<Team[]> => {
  try {
    const response = await axios.get('/api/teams/my-teams/');
    return response.data;
  } catch (error) {
    handleApiError(error);
    return [];
  }
};

/**
 * Get teams that the current user owns or leads
 */
export const getTeamsILead = async (): Promise<Team[]> => {
  try {
    const response = await axios.get('/api/teams/my-led-teams/');
    return response.data;
  } catch (error) {
    handleApiError(error);
    return [];
  }
};

/**
 * Get detailed information about a specific team
 */
export const getTeamDetails = async (teamId: number): Promise<Team | null> => {
  try {
    const response = await axios.get(`/api/teams/${teamId}/`);
    return response.data;
  } catch (error) {
    handleApiError(error);
    return null;
  }
};

/**
 * Invite a new member to a team
 */
export const inviteTeamMember = async (
  teamId: number, 
  data: { username: string; email: string; role: 'admin' | 'member' }
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await axios.post(`/api/teams/${teamId}/invite/`, data);
    return { 
      success: true, 
      message: response.data.message || 'Invitation sent successfully'
    };
  } catch (error) {
    return {
      success: false,
      message: handleApiError(error)
    };
  }
};

/**
 * Remove a member from a team
 */
export const removeTeamMember = async (
  teamId: number,
  memberId: number
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await axios.delete(`/api/teams/${teamId}/members/${memberId}/`);
    return {
      success: true,
      message: response.data.message || 'Member removed successfully'
    };
  } catch (error) {
    return {
      success: false,
      message: handleApiError(error)
    };
  }
};

/**
 * Promote a team member to admin role
 */
export const promoteToAdmin = async (
  teamId: number,
  memberId: number
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await axios.post(`/api/teams/${teamId}/members/${memberId}/promote/`);
    return {
      success: true,
      message: response.data.message || 'Member promoted to admin successfully'
    };
  } catch (error) {
    return {
      success: false,
      message: handleApiError(error)
    };
  }
};

/**
 * Demote an admin to regular member
 */
export const demoteToMember = async (
  teamId: number,
  adminId: number
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await axios.post(`/api/teams/${teamId}/members/${adminId}/demote/`);
    return {
      success: true,
      message: response.data.message || 'Admin demoted to member successfully'
    };
  } catch (error) {
    return {
      success: false,
      message: handleApiError(error)
    };
  }
};

/**
 * Get detailed information about a team member
 */
export const getTeamMemberDetails = async (
  teamId: number,
  memberId: number
): Promise<TeamMember | null> => {
  try {
    const response = await axios.get(`/api/teams/${teamId}/members/${memberId}/`);
    return response.data;
  } catch (error) {
    handleApiError(error);
    return null;
  }
};

/**
 * Search for users that can be invited to a team
 */
export const searchPotentialMembers = async (
  query: string
): Promise<TeamMember[]> => {
  try {
    const response = await axios.get(`/api/users/search/?q=${encodeURIComponent(query)}`);
    return response.data;
  } catch (error) {
    handleApiError(error);
    return [];
  }
};

/**
 * Helper function to handle API errors consistently
 */
const handleApiError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const statusCode = error.response?.status || 'unknown';
    const errorMessage = error.response?.data?.detail || error.message || 'Unknown error';
    console.error(`API error ${statusCode}: ${errorMessage}`);
    return errorMessage;
  }
  
  const message = error instanceof Error ? error.message : 'Unknown error occurred';
  console.error(`Non-Axios error: ${message}`);
  return message;
};
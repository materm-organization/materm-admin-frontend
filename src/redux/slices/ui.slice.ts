import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// Example client-only state: a generic "currently active workspace/tenant"
// scaffold. React Query owns everything that originates from the API — this
// slice exists only for state that's genuinely client-only and needs to be
// read from disconnected places. Replace/extend it with your project's real
// client-only UI state.
type UiState = {
  activeWorkspaceId: string | null;
};

const initialState: UiState = {
  activeWorkspaceId: null,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setActiveWorkspaceId: (state, action: PayloadAction<string | null>) => {
      state.activeWorkspaceId = action.payload;
    },
  },
});

export const { setActiveWorkspaceId } = uiSlice.actions;
export default uiSlice.reducer;

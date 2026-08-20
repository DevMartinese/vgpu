# Source this file before project commands so the active shell can switch Node.
# If no supported version manager is installed, keep the caller's current Node.
if command -v fnm >/dev/null 2>&1; then
  fnm use
elif command -v nvm >/dev/null 2>&1; then
  nvm use
else
  vgpu_nvm_script=""

  if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
    vgpu_nvm_script="$NVM_DIR/nvm.sh"
  elif [ -s "$HOME/.nvm/nvm.sh" ]; then
    vgpu_nvm_script="$HOME/.nvm/nvm.sh"
  elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
    vgpu_nvm_script="/opt/homebrew/opt/nvm/nvm.sh"
  elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    vgpu_nvm_script="/usr/local/opt/nvm/nvm.sh"
  fi

  if [ -n "$vgpu_nvm_script" ]; then
    . "$vgpu_nvm_script"
    nvm use
  fi

  unset vgpu_nvm_script
fi

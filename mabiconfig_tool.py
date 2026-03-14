from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from mabiconfig_codec import decode_file, encode_file, get_backup_target
from mabiconfig_version import APP_NAME, APP_TITLE, APP_VERSION

ICON_FILE_NAME = "mabi_tools.ico"


def apply_window_icon(window: tk.Tk) -> None:
    for candidate in (
        pathlib.Path(__file__).with_name(ICON_FILE_NAME),
        pathlib.Path(sys.executable).with_name(ICON_FILE_NAME),
    ):
        if candidate.exists():
            try:
                window.iconbitmap(str(candidate))
                return
            except Exception:
                pass


def default_mabinogi_dir() -> pathlib.Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return pathlib.Path(appdata) / "Mabinogi" / "Setting"
    return pathlib.Path.cwd()


class App(ttk.Frame):
    def __init__(self, master: tk.Tk) -> None:
        super().__init__(master, padding=12)
        self.master = master
        self.pack(fill="both", expand=True)

        self.default_input_dir = default_mabinogi_dir()
        self.last_used_dir = self.default_input_dir if self.default_input_dir.exists() else pathlib.Path.cwd()
        self.mode = tk.StringVar(value="decode")
        self.output_dir = tk.StringVar(value=str(self.last_used_dir))
        self.file_count = tk.StringVar(value="선택된 파일 없음")
        self.selected_files: list[pathlib.Path] = []

        self._build_ui()

    def _build_ui(self) -> None:
        self.master.title(APP_TITLE)
        self.master.geometry("820x680")
        self.master.minsize(760, 620)

        title = ttk.Label(self, text=APP_NAME, font=("맑은 고딕", 16, "bold"))
        title.pack(anchor="w")
        ttk.Label(self, text=f"버전 {APP_VERSION} · 인코딩 XML ↔ 디코딩 XML 변환", foreground="#555").pack(anchor="w", pady=(0, 12))

        mode_frame = ttk.LabelFrame(self, text="작업 모드", padding=10)
        mode_frame.pack(fill="x")
        ttk.Radiobutton(mode_frame, text="디코드: 게임 포맷 → 일반 XML", variable=self.mode, value="decode").pack(anchor="w")
        ttk.Radiobutton(mode_frame, text="인코드: 일반 XML → 게임 포맷", variable=self.mode, value="encode").pack(anchor="w")

        file_frame = ttk.LabelFrame(self, text="입력 파일", padding=10)
        file_frame.pack(fill="x", pady=(12, 0))
        ttk.Button(file_frame, text="파일 선택", command=self.choose_files).pack(side="left")
        ttk.Label(file_frame, textvariable=self.file_count).pack(side="left", padx=(12, 0))

        output_frame = ttk.LabelFrame(self, text="출력 폴더", padding=10)
        output_frame.pack(fill="x", pady=(12, 0))
        entry = ttk.Entry(output_frame, textvariable=self.output_dir)
        entry.pack(side="left", fill="x", expand=True)
        ttk.Button(output_frame, text="찾아보기", command=self.choose_output_dir).pack(side="left", padx=(8, 0))

        action_frame = ttk.Frame(self, padding=(0, 12, 0, 0))
        action_frame.pack(fill="x")
        ttk.Button(action_frame, text="실행", command=self.run).pack(side="left")
        ttk.Button(action_frame, text="목록 지우기", command=self.clear_files).pack(side="left", padx=(8, 0))
        ttk.Button(action_frame, text="출력 폴더 열기", command=self.open_output_dir).pack(side="left", padx=(8, 0))

        preview_frame = ttk.LabelFrame(self, text="선택 파일 목록", padding=10)
        preview_frame.pack(fill="both", expand=True, pady=(12, 0))
        self.file_list = tk.Listbox(preview_frame, height=6)
        self.file_list.pack(fill="both", expand=True)

        log_frame = ttk.LabelFrame(self, text="작업 로그", padding=10)
        log_frame.pack(fill="both", expand=True, pady=(12, 0))
        self.log = tk.Text(log_frame, height=8, wrap="word")
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

    def choose_files(self) -> None:
        filetypes = [("XML files", "*.xml"), ("All files", "*.*")]
        initial_dir = self.last_used_dir if self.last_used_dir.exists() else pathlib.Path.cwd()
        paths = filedialog.askopenfilenames(title="입력 파일 선택", filetypes=filetypes, initialdir=str(initial_dir))
        if not paths:
            return
        self.selected_files = [pathlib.Path(path) for path in paths]
        self.last_used_dir = self.selected_files[0].parent
        self.refresh_file_list()

    def choose_output_dir(self) -> None:
        initial_dir = self.last_used_dir if self.last_used_dir.exists() else pathlib.Path.cwd()
        path = filedialog.askdirectory(title="출력 폴더 선택", initialdir=str(initial_dir))
        if path:
            self.output_dir.set(path)
            self.last_used_dir = pathlib.Path(path)

    def clear_files(self) -> None:
        self.selected_files.clear()
        self.refresh_file_list()
        self.write_log("파일 목록을 비웠습니다.")

    def refresh_file_list(self) -> None:
        self.file_list.delete(0, tk.END)
        for path in self.selected_files:
            self.file_list.insert(tk.END, str(path))
        self.file_count.set(f"선택된 파일 {len(self.selected_files)}개" if self.selected_files else "선택된 파일 없음")

    def write_log(self, message: str) -> None:
        self.log.configure(state="normal")
        self.log.insert(tk.END, message + "\n")
        self.log.see(tk.END)
        self.log.configure(state="disabled")

    def open_output_dir(self) -> None:
        output_dir = pathlib.Path(self.output_dir.get())
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            if os.name == "nt":
                os.startfile(output_dir)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", str(output_dir)])
            self.write_log(f"출력 폴더 열기: {output_dir}")
        except Exception as exc:
            messagebox.showerror("폴더 열기 실패", str(exc))

    def run(self) -> None:
        if not self.selected_files:
            messagebox.showwarning("파일 없음", "먼저 입력 파일을 선택하세요.")
            return

        output_dir = pathlib.Path(self.output_dir.get())
        output_dir.mkdir(parents=True, exist_ok=True)

        success = 0
        failed = 0
        mode = self.mode.get()
        self.write_log(f"[{mode}] 작업 시작")

        for input_path in self.selected_files:
            try:
                if mode == "decode":
                    output_name = input_path.stem + ".decoded.xml"
                    output_path = output_dir / output_name
                    backup_path = get_backup_target(output_path)
                    decode_file(input_path, output_path)
                else:
                    if input_path.name.endswith(".decoded.xml"):
                        output_name = input_path.name.replace(".decoded.xml", ".xml")
                    else:
                        output_name = input_path.stem + ".encoded.xml"
                    output_path = output_dir / output_name
                    backup_path = get_backup_target(output_path)
                    encode_file(input_path, output_path)
                success += 1
                self.write_log(f"성공: {input_path.name} -> {output_path.name}")
                if backup_path is not None:
                    self.write_log(f"기존 파일 백업: {backup_path.name}")
            except Exception as exc:
                failed += 1
                self.write_log(f"실패: {input_path.name} -> {exc}")

        messagebox.showinfo("완료", f"성공 {success}개, 실패 {failed}개")


def main() -> None:
    root = tk.Tk()
    apply_window_icon(root)
    style = ttk.Style(root)
    if "vista" in style.theme_names():
        style.theme_use("vista")
    app = App(root)
    app.mainloop()


if __name__ == "__main__":
    main()

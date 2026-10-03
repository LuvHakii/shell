pub use std::os::wasi::fs::{FileTypeExt, MetadataExt};

use std::fs::Metadata;
use uucore::fs::display_permissions_unix;
use uucore::fs::mode::{
    S_IFBLK, S_IFCHR, S_IFDIR, S_IFIFO, S_IFLNK, S_IFMT, S_IFREG, S_IFSOCK,
};

pub trait FakeMetadataExt {
    fn mode(&self) -> u32;
    fn uid(&self) -> u32;
    fn gid(&self) -> u32;
    fn blocks(&self) -> u64;
    fn blksize(&self) -> u64;
    fn rdev(&self) -> u64;
}

impl FakeMetadataExt for Metadata {
    fn mode(&self) -> u32 {
        let t = self.file_type();
        if t.is_dir() {
            S_IFDIR | 0o755
        } else if t.is_symlink() {
            S_IFLNK | 0o777
        } else if t.is_char_device() {
            S_IFCHR | 0o644
        } else if t.is_block_device() {
            S_IFBLK | 0o644
        } else {
            S_IFREG | 0o644
        }
    }

    fn uid(&self) -> u32 {
        0
    }

    fn gid(&self) -> u32 {
        0
    }

    fn blocks(&self) -> u64 {
        self.len().div_ceil(512)
    }

    fn blksize(&self) -> u64 {
        4096
    }

    fn rdev(&self) -> u64 {
        0
    }
}

pub fn major(dev: u64) -> u32 {
    (dev >> 8 & 0xfff) as u32
}

pub fn minor(dev: u64) -> u32 {
    (dev & 0xff) as u32
}

pub fn pretty_filetype(mode: u32, size: u64) -> String {
    match mode & S_IFMT {
        S_IFREG => {
            if size == 0 {
                "regular empty file"
            } else {
                "regular file"
            }
        }
        S_IFDIR => "directory",
        S_IFLNK => "symbolic link",
        S_IFCHR => "character special file",
        S_IFBLK => "block special file",
        S_IFIFO => "fifo",
        S_IFSOCK => "socket",
        _ => return format!("weird file ({:07o})", mode & S_IFMT),
    }
    .to_owned()
}

pub fn display_permissions(meta: &Metadata, display_file_type: bool) -> String {
    display_permissions_unix(meta.mode(), display_file_type)
}

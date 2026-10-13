import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_tool', Path(__file__).resolve().parents[1] / 'tools' / 'package_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_archive_uses_allowlist_and_ignores_local_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('Public example project', encoding='utf-8')
            (root / 'data').mkdir()
            (root / 'data' / 'private.sqlite').write_bytes(b'not for publication')
            with patch.object(release, 'ROOT', root), patch.object(release, 'PUBLIC_FILES', ('README.md',)):
                result = release.package(root / 'source.zip')
            self.assertFalse(result['runtime_data_included'])
            with zipfile.ZipFile(root / 'source.zip') as archive:
                self.assertEqual(set(archive.namelist()), {'knowledge-nebula/README.md', 'knowledge-nebula/RELEASE_MANIFEST.json'})
                manifest = json.loads(archive.read('knowledge-nebula/RELEASE_MANIFEST.json'))
                self.assertEqual(list(manifest['files']), ['README.md'])

    def test_identifier_and_profile_path_scan_reports_category_only(self):
        examples = [('oc_' + 'a' * 32, 'identifier'), ('C:/' + 'Users/' + 'example/private.txt', 'profile path')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for sample, category in examples:
                (root / 'README.md').write_text(sample, encoding='utf-8')
                with patch.object(release, 'ROOT', root), patch.object(release, 'PUBLIC_FILES', ('README.md',)):
                    with self.assertRaises(ValueError) as error:
                        release.public_files()
                self.assertIn(category, str(error.exception))
                self.assertNotIn(sample, str(error.exception))


if __name__ == '__main__':
    unittest.main()
